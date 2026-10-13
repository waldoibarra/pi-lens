import { expect, test } from 'bun:test'
import {
  AssistantMessageComponent,
  CustomMessageComponent,
  UserMessageComponent,
  ToolExecutionComponent,
  createReadToolDefinition,
  initTheme,
} from '@earendil-works/pi-coding-agent'
import {
  Container,
  ScrollView,
  Text,
  TuiAltScreen,
  VStack,
  setCapabilities,
  type Component,
  type Terminal,
} from '@earendil-works/pi-tui'
import { theme } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js'
import { attachProjection } from '../src/adapter'
import { projectTranscript } from '../src/presentation'
import { LensState } from '../src/state'
import { preserveViewport } from '../src/viewport'

const plainLines = (lines: string[]) => lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ''))

function scrollUntil(
  fixture: { input(data: string): void },
  tui: TuiAltScreen,
  needle: string,
): string[] {
  for (let attempt = 0; attempt < 12; attempt++) {
    tui.renderNow()
    const lines = tui.getScreenLines()
    if (lines.some((line) => line.includes(needle))) return lines
    fixture.input('\x1b[6~')
  }
  tui.renderNow()
  return tui.getScreenLines()
}

function terminalFixture() {
  let input = (_data: string) => {}
  const terminal: Terminal = {
    columns: 80,
    rows: 10,
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
  return { terminal, input: (data: string) => input(data) }
}

test.each(['tool', 'image', 'voice', 'thinking', 'input'] as const)(
  'opening real Lens %s details keeps its header on screen',
  (kind) => {
    initTheme('dark', false)
    const fixture = terminalFixture()
    const tui = new TuiAltScreen(fixture.terminal, false, undefined, { copyOnSelect: false })
    const state = new LensState()
    const chat = new Container()
    const sentinel = `PIN_${kind.toUpperCase()}`
    const body = Array.from(
      { length: 30 },
      (_, index) => `- ${kind.toUpperCase()}_DETAIL_${index + 1}`,
    ).join('\n')
    let row: Component
    if (kind === 'tool') {
      const tool = new ToolExecutionComponent(
        'read',
        'tool',
        { path: sentinel },
        {},
        createReadToolDefinition('/project'),
        tui,
        '/project',
      )
      tool.updateResult({ content: [{ type: 'text', text: body }], isError: false })
      row = tool
    } else if (kind === 'image') {
      setCapabilities({ images: 'kitty', trueColor: true, hyperlinks: false })
      const tool = new ToolExecutionComponent(
        'read',
        'image',
        { path: `${sentinel}.png` },
        {},
        createReadToolDefinition('/project'),
        tui,
        '/project',
      )
      tool.updateResult({
        content: [
          { type: 'text', text: `Read image file [image/png]\n${body}` },
          {
            type: 'image',
            mimeType: 'image/png',
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1z8AAAAASUVORK5CYII=',
          },
        ],
        isError: false,
      })
      row = tool
    } else if (kind === 'input') {
      const content = `${sentinel}\n\n${body}`
      row = new UserMessageComponent(content)
      Object.defineProperty(row, 'binding', {
        value: {
          message: Object.freeze({ role: 'user', content, timestamp: 100 }),
          inputDisplay: { version: 1, input: { id: 'input', origin: 'extension' } },
          part: 'body',
        },
      })
    } else if (kind === 'voice') {
      row = new CustomMessageComponent({
        role: 'custom',
        customType: 'pi-live-codex-delegation',
        content: `${sentinel}\n\n${body}`,
        details: { delegationId: 'voice' },
        display: true,
        timestamp: 100,
      } as never)
    } else {
      row = new AssistantMessageComponent(
        {
          role: 'assistant',
          timestamp: 100,
          stopReason: 'stop',
          content: [{ type: 'thinking', thinking: `**${sentinel}**\n\n${body}` }],
        } as never,
        true,
      )
    }
    chat.addChild(
      new Text(Array.from({ length: 16 }, (_, index) => `BEFORE_${index}`).join('\n'), 0, 0),
    )
    chat.addChild(row)
    chat.addChild(
      new Text(Array.from({ length: 5 }, (_, index) => `AFTER_${index}`).join('\n'), 0, 0),
    )
    const viewport = new ScrollView(chat, { primary: true, follow: 'end' })
    const editor = new Text('EDITOR', 0, 0)
    tui.setLayoutRoot(
      new VStack([
        { component: viewport, grow: 1, shrink: 1, minSize: 0 },
        { component: editor, basis: 1, shrink: 0 },
      ]),
    )
    tui.setFocus(editor)
    const detach = attachProjection(
      chat,
      () => true,
      () =>
        projectTranscript(chat.children, state, theme, () => {
          preserveViewport(tui)
          tui.requestRender()
        }),
    )
    try {
      tui.start()
      tui.renderNow()
      const beforeTop = viewport.scrollTop
      const beforeLines = plainLines(tui.getScreenLines())
      const beforeY = beforeLines.findIndex((line) => line.includes(sentinel))
      expect(beforeY).toBeGreaterThanOrEqual(0)
      const beforeAbove = beforeLines.slice(0, beforeY)
      expect(viewport.isFollowingEnd).toBe(true)
      fixture.input(`\x1b[<0;3;${beforeY + 1}M`)
      fixture.input(`\x1b[<0;3;${beforeY + 1}m`)
      tui.renderNow()
      const openedLines = plainLines(tui.getScreenLines())
      expect([...state.open]).toHaveLength(1)
      expect(viewport.scrollTop).toBe(beforeTop)
      expect(openedLines.findIndex((line) => line.includes(sentinel))).toBe(beforeY)
      expect(openedLines.slice(0, beforeY)).toEqual(beforeAbove)
      expect(viewport.isFollowingEnd).toBe(false)
      expect(tui.getFocusedComponent()).toBe(editor)
      chat.addChild(new Text('STREAM_AFTER_OPEN', 0, 0))
      tui.renderNow()
      expect(plainLines(tui.getScreenLines()).slice(0, beforeY)).toEqual(beforeAbove)
      expect(plainLines(tui.getScreenLines()).findIndex((line) => line.includes(sentinel))).toBe(
        beforeY,
      )
      fixture.input(`\x1b[<0;3;${beforeY + 1}M`)
      fixture.input(`\x1b[<0;3;${beforeY + 1}m`)
      tui.renderNow()
      const collapsed = plainLines(tui.getScreenLines())
      expect([...state.open]).toHaveLength(0)
      expect(collapsed.slice(0, beforeY)).toEqual(beforeAbove)
      expect(collapsed.findIndex((line) => line.includes(sentinel))).toBe(beforeY)
      chat.addChild(new Text('STREAM_AFTER_COLLAPSE', 0, 0))
      tui.renderNow()
      expect(plainLines(tui.getScreenLines()).slice(0, beforeY)).toEqual(beforeAbove)
      expect(plainLines(tui.getScreenLines()).findIndex((line) => line.includes(sentinel))).toBe(
        beforeY,
      )
      expect(viewport.isFollowingEnd).toBe(false)
      // A third rapid click at one coordinate is native line selection, not disclosure activation.
      fixture.input(`\x1b[<0;70;${beforeY + 1}M`)
      fixture.input(`\x1b[<0;70;${beforeY + 1}m`)
      tui.renderNow()
      expect([...state.open]).toHaveLength(1)
      if (kind === 'thinking') {
        const updateLines = plainLines(scrollUntil(fixture, tui, `• ▸ ${sentinel}`))
        const updateY = updateLines.findIndex(
          (line) => line.includes(`• ▸ ${sentinel}`) || line.includes(`•  ${sentinel}`),
        )
        expect(updateY).toBeGreaterThanOrEqual(0)
        const updateAbove = updateLines.slice(0, updateY)
        fixture.input(`\x1b[<0;3;${updateY + 1}M`)
        fixture.input(`\x1b[<0;3;${updateY + 1}m`)
        tui.renderNow()
        expect([...state.open].sort()).toEqual(['progress-detail:100:0:0', 'progress:100:0'])
        expect(plainLines(tui.getScreenLines()).slice(0, updateY)).toEqual(updateAbove)
      }
      if (kind === 'image') {
        const detailsLines = plainLines(scrollUntil(fixture, tui, 'Details'))
        const detailsY = detailsLines.findIndex((line) => line.includes('Details'))
        expect(detailsY).toBeGreaterThanOrEqual(0)
        const detailsAbove = detailsLines.slice(0, detailsY)
        fixture.input(`\x1b[<0;3;${detailsY + 1}M`)
        fixture.input(`\x1b[<0;3;${detailsY + 1}m`)
        tui.renderNow()
        const detailsOpened = plainLines(tui.getScreenLines())
        expect([...state.open].sort()).toEqual(['image-details:image', 'step:image'])
        expect(detailsOpened.findIndex((line) => line.includes('Details'))).toBe(detailsY)
        expect(detailsOpened.slice(0, detailsY)).toEqual(detailsAbove)
        chat.addChild(new Text('STREAM_DETAILS_OPEN', 0, 0))
        tui.renderNow()
        expect(plainLines(tui.getScreenLines()).slice(0, detailsY)).toEqual(detailsAbove)
        expect(plainLines(tui.getScreenLines()).findIndex((line) => line.includes('Details'))).toBe(
          detailsY,
        )
        fixture.input(`\x1b[<0;3;${detailsY + 1}M`)
        fixture.input(`\x1b[<0;3;${detailsY + 1}m`)
        tui.renderNow()
        expect(state.open.has('image-details:image')).toBe(false)
        chat.addChild(new Text('STREAM_DETAILS_CLOSED', 0, 0))
        tui.renderNow()
        expect(plainLines(tui.getScreenLines()).slice(0, detailsY)).toEqual(detailsAbove)
        expect(plainLines(tui.getScreenLines()).findIndex((line) => line.includes('Details'))).toBe(
          detailsY,
        )
        fixture.input(`\x1b[<0;70;${detailsY + 1}M`)
        fixture.input(`\x1b[<0;70;${detailsY + 1}m`)
        tui.renderNow()
        expect(state.open.has('image-details:image')).toBe(true)
      }
      expect(
        scrollUntil(fixture, tui, `${kind.toUpperCase()}_DETAIL_30`).some((line) =>
          line.includes(`${kind.toUpperCase()}_DETAIL_30`),
        ),
      ).toBe(true)
    } finally {
      detach()
      tui.stop()
    }
  },
)

function observedTools(count: number) {
  const state = new LensState()
  state.observe({
    role: 'assistant',
    timestamp: 100,
    model: 'gpt-6-astra',
    content: Array.from({ length: count }, (_, i) => ({ type: 'toolCall', id: `pin-${i}` })),
  })
  return state
}

function readTool(id: string, tui: TuiAltScreen): ToolExecutionComponent {
  const row = new ToolExecutionComponent(
    'read',
    id,
    { path: `/project/${id}.ts` },
    {},
    createReadToolDefinition('/project'),
    tui,
    '/project',
  )
  row.updateResult({ content: [{ type: 'text', text: `DETAIL_${id}` }], isError: false })
  return row
}

test.each(['normal-more', 'clean-fold'] as const)(
  'opening real Lens %s control keeps upper rows and header pinned',
  (kind) => {
    initTheme('dark', false)
    const fixture = terminalFixture()
    const tui = new TuiAltScreen(fixture.terminal, false, undefined, { copyOnSelect: false })
    const state = observedTools(7)
    if (kind === 'clean-fold') state.view = 'clean'
    const chat = new Container()
    chat.children = Array.from({ length: 7 }, (_, i) => readTool(`pin-${i}`, tui))
    const viewport = new ScrollView(chat, { primary: true, follow: 'end' })
    const editor = new Text('EDITOR', 0, 0)
    tui.setLayoutRoot(
      new VStack([
        { component: viewport, grow: 1, shrink: 1, minSize: 0 },
        { component: editor, basis: 1, shrink: 0 },
      ]),
    )
    tui.setFocus(editor)
    const detach = attachProjection(
      chat,
      () => true,
      () =>
        projectTranscript(chat.children, state, theme, () => {
          preserveViewport(tui)
          tui.requestRender()
        }),
    )
    try {
      tui.start()
      tui.renderNow()
      const needle = kind === 'normal-more' ? '+2 more' : '7 steps'
      const before = plainLines(tui.getScreenLines())
      const y = before.findIndex((line) => line.includes(needle))
      expect(y).toBeGreaterThanOrEqual(0)
      const above = before.slice(0, y)
      fixture.input(`\x1b[<0;3;${y + 1}M`)
      fixture.input(`\x1b[<0;3;${y + 1}m`)
      tui.renderNow()
      const after = plainLines(tui.getScreenLines())
      expect(after.slice(0, y)).toEqual(above)
      if (kind === 'normal-more') {
        expect(after[y]).toContain('show fewer')
        expect(after[y + 1]).toContain('Read pin-5.ts')
      } else {
        expect(after[y]).toContain('▾ 7 steps')
        expect(after[y + 1]).toContain('Read pin-0.ts')
      }
      expect(viewport.isFollowingEnd).toBe(false)
      chat.addChild(new Text('STREAM_WHILE_OPEN', 0, 0))
      tui.renderNow()
      expect(plainLines(tui.getScreenLines()).slice(0, y)).toEqual(above)
      expect(plainLines(tui.getScreenLines())[y]).toEqual(after[y])
      fixture.input(`\x1b[<0;3;${y + 1}M`)
      fixture.input(`\x1b[<0;3;${y + 1}m`)
      tui.renderNow()
      const collapsed = plainLines(tui.getScreenLines())
      expect(collapsed.slice(0, y)).toEqual(above)
      expect(collapsed[y]).toContain(needle)
      chat.addChild(new Text('STREAM_WHILE_CLOSED', 0, 0))
      tui.renderNow()
      const streamed = plainLines(tui.getScreenLines())
      expect(streamed.slice(0, y)).toEqual(above)
      expect(streamed[y]).toEqual(collapsed[y])
      expect(viewport.isFollowingEnd).toBe(false)
      expect(tui.getFocusedComponent()).toBe(editor)
    } finally {
      detach()
      tui.stop()
    }
  },
)
