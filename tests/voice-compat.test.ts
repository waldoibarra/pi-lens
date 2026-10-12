import { expect, test } from 'bun:test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { copyFileSync, mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Container, Text } from '@earendil-works/pi-tui'
import { initTheme } from '@earendil-works/pi-coding-agent'
import {
  theme,
  getEditorTheme,
} from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js'
import { KeybindingsManager } from '../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js'
import { attachProjection } from '../src/adapter'

const voiceRoot = process.env.PI_LENS_VOICE_ROOT

test.skipIf(!voiceRoot)(
  'the real voice visualizer retains its drawing and mute/stop controls',
  async () => {
    initTheme('dark', false)
    // Test the unmodified source with the same host peers Pi normally supplies through its loader.
    const fixture = mkdtempSync(join(tmpdir(), 'pi-lens-voice-'))
    copyFileSync(join(voiceRoot!, 'visualizer.ts'), join(fixture, 'visualizer.ts'))
    symlinkSync(
      fileURLToPath(new URL('../node_modules', import.meta.url)),
      join(fixture, 'node_modules'),
    )
    const { LiveVisualizer } = await import(pathToFileURL(join(fixture, 'visualizer.ts')).href)
    const tui = new Container()
    Object.assign(tui, { requestRender() {}, terminal: { rows: 50, columns: 100 } })
    let mute = 0
    let stop = 0
    const visualizer = new LiveVisualizer(tui, getEditorTheme(), new KeybindingsManager(), theme, {
      onStop: () => stop++,
      onToggleMute: () => mute++,
      onResume() {},
      onDrop() {},
    })
    visualizer.setPhase('listening')
    visualizer.setUserTranscript('Read the configuration', true)
    visualizer.setAgentTranscript('Checking the files', true)
    visualizer.setInputLevel(0.3)
    const chat = new Container()
    chat.addChild(new Text('Native tools', 0, 0))
    tui.addChild(chat)
    tui.addChild(visualizer)
    const before = visualizer.render(100)
    const handleInput = visualizer.handleInput
    const detach = attachProjection(
      chat,
      () => true,
      () => [new Text('Folded tools', 0, 0)],
    )
    tui.render(100)
    expect(visualizer.render(100)).toEqual(before)
    expect(visualizer.handleInput).toBe(handleInput)
    visualizer.handleInput(' ')
    visualizer.handleInput('\x1b')
    expect(mute).toBe(1)
    expect(stop).toBe(1)
    detach()
    expect(visualizer.render(100)).toEqual(before)
  },
)
