import { expect, test } from 'bun:test'
import { initTheme } from '@earendil-works/pi-coding-agent'
import {
  Container,
  Text,
  TuiAltScreen,
  hyperlink,
  type Component,
  type Terminal,
} from '@earendil-works/pi-tui'
import { theme } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js'
import { HoverController, hoverHeader } from '../src/hover'

/** Real fullscreen input/rendering with a memory terminal: no OS input, clipboard, or audio. */
test('fullscreen SGR motion highlights headers without stealing selection, clicks, or editor keys', () => {
  initTheme('dark', false)
  let input: (data: string) => void = () => {}
  const terminal: Terminal = {
    columns: 80,
    rows: 16,
    kittyProtocolActive: false,
    start(onInput) {
      input = onInput
    },
    stop() {},
    drainInput: async () => {},
    write() {},
    moveBy() {},
    hideCursor() {},
    showCursor() {},
    clearLine() {},
    clearFromCursor() {},
    clearScreen() {},
    setTitle() {},
    setProgress() {},
    setProgramStatus() {},
  }
  const urls: string[] = []
  const tui = new TuiAltScreen(terminal, false, undefined, {
    copyOnSelect: false,
    openUrl: (url) => urls.push(url),
  })
  const hover = new HoverController()
  let clicks = 0
  const keys: string[] = []
  const editor: Component = {
    render: () => ['VOICE_EDITOR_SENTINEL'],
    invalidate() {},
    handleInput: (data) => keys.push(data),
  }
  const chat = new Container()
  chat.addChild(
    hoverHeader(new Text('HEADER_HOVER_TARGET', 0, 0), 'step:target', () => clicks++, theme, hover),
  )
  chat.addChild(new Text('SELECTION_TARGET_TEXT', 0, 0))
  chat.addChild(new Text(hyperlink('LINK_TARGET', 'https://example.invalid/lens'), 0, 0))
  tui.addChild(chat)
  tui.addChild(editor)
  tui.setFocus(editor)
  hover.bind(tui, () => tui.requestRender())
  try {
    tui.start()
    tui.renderNow()
    const before = tui.getScreenLines()
    const headerY = before.findIndex((line) => line.includes('HEADER_HOVER_TARGET'))
    const otherY = before.findIndex((line) => line.includes('SELECTION_TARGET_TEXT'))
    expect(headerY).toBeGreaterThanOrEqual(0)
    expect(otherY).toBeGreaterThanOrEqual(0)
    input(`\x1b[<35;3;${headerY + 1}M`)
    tui.renderNow()
    expect(tui.getScreenLines()[headerY]).not.toBe(before[headerY])
    expect(clicks).toBe(0)
    expect(tui.getFocusedComponent()).toBe(editor)

    input(`\x1b[<35;3;${otherY + 1}M`)
    tui.renderNow()
    expect(tui.getScreenLines()[headerY]).toBe(before[headerY])
    input(`\x1b[<0;1;${otherY + 1}M`)
    input(`\x1b[<32;8;${otherY + 1}M`)
    input(`\x1b[<0;8;${otherY + 1}m`)
    tui.renderNow()
    expect(tui.hasActiveSelection()).toBe(true)
    input(`\x1b[<35;3;${headerY + 1}M`)
    tui.renderNow()
    expect(tui.hasActiveSelection()).toBe(true)

    input(' ')
    expect(keys).toEqual([' '])
    expect(tui.getFocusedComponent()).toBe(editor)
    const linkY = before.findIndex((line) => line.includes('LINK_TARGET'))
    input(`\x1b[<35;3;${linkY + 1}M`)
    input(`\x1b[<0;3;${linkY + 1}M`)
    input(`\x1b[<0;3;${linkY + 1}m`)
    expect(urls).toEqual(['https://example.invalid/lens'])
    input(`\x1b[<0;3;${headerY + 1}M`)
    input(`\x1b[<0;3;${headerY + 1}m`)
    tui.renderNow()
    expect(clicks).toBe(1)
  } finally {
    hover.dispose()
    tui.stop()
  }
})
