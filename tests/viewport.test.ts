import { expect, test } from 'bun:test'
import {
  ScrollView,
  Text,
  TuiAltScreen,
  VStack,
  type Component,
  type Terminal,
} from '@earendil-works/pi-tui'
import { preserveViewport, releaseViewport } from '../src/viewport'

class MutableLines implements Component {
  constructor(private readonly getLines: () => string[]) {}

  render(): string[] {
    return this.getLines()
  }

  invalidate() {}
}

function memoryTerminal(): { terminal: Terminal; input: (data: string) => void } {
  let input: (data: string) => void = () => {}
  return {
    get input() {
      return input
    },
    terminal: {
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
    },
  }
}

function linesFor(options: {
  readonly beforeCount: number
  readonly afterCount: number
  readonly detailCount: number
  readonly label: string
  readonly expanded: boolean
}): string[] {
  const prefix = Array.from(
    { length: options.beforeCount },
    (_, index) => `${options.label}_BEFORE_${index.toString().padStart(2, '0')}`,
  )
  const details = options.expanded
    ? Array.from(
        { length: options.detailCount },
        (_, index) => `${options.label}_DETAIL_${(index + 1).toString().padStart(2, '0')}`,
      )
    : []
  const suffix = Array.from(
    { length: options.afterCount },
    (_, index) => `${options.label}_AFTER_${index.toString().padStart(2, '0')}`,
  )
  return [...prefix, `${options.label}_HEADER`, ...details, ...suffix]
}

function createFullscreenFixture(options: {
  readonly beforeCount: number
  readonly afterCount: number
  readonly detailCount: number
  readonly label: string
}) {
  const terminal = memoryTerminal()
  let expanded = false
  const document = new MutableLines(() => linesFor({ ...options, expanded }))
  const scrollView = new ScrollView(document, { follow: 'end', primary: true })
  const editor = new Text('EDITOR_FOCUS_SENTINEL', 0, 0)
  const root = new VStack([
    { component: scrollView, grow: 1, shrink: 1, minSize: 0 },
    { component: editor, basis: 1, shrink: 0 },
  ])
  const tui = new TuiAltScreen(terminal.terminal, false, undefined, {
    copyOnSelect: false,
    wheelScrollLines: 1,
  })
  tui.setLayoutRoot(root)
  tui.setFocus(editor)
  tui.start()
  tui.renderNow()

  return {
    tui,
    input: terminal.input,
    scrollView,
    editor,
    expand() {
      expanded = true
    },
    stop() {
      tui.stop()
    },
  }
}

function visibleRow(tui: TuiAltScreen, text: string): number {
  return tui.getScreenLines().findIndex((line) => line.includes(text))
}

test.each([
  {
    name: 'tool details while following the end',
    beforeCount: 16,
    afterCount: 5,
    detailCount: 5,
    label: 'TOOL',
    position: 'end',
  },
  {
    name: 'voice details while manually scrolled up',
    beforeCount: 10,
    afterCount: 18,
    detailCount: 9,
    label: 'VOICE',
    position: 7,
  },
  {
    name: 'thinking details when initially short content becomes scrollable',
    beforeCount: 2,
    afterCount: 2,
    detailCount: 12,
    label: 'THINKING',
    position: 'initial-short',
  },
])('preserves viewport for $name', (scenario) => {
  const fixture = createFullscreenFixture(scenario)
  try {
    if (scenario.position === 'end') {
      fixture.scrollView.scrollToEnd()
    } else if (typeof scenario.position === 'number') {
      fixture.scrollView.scrollTo(scenario.position, { disableFollow: true })
    }
    fixture.tui.renderNow()

    const beforeTop = fixture.scrollView.scrollTop
    const beforeHeaderY = visibleRow(fixture.tui, `${scenario.label}_HEADER`)
    expect(beforeHeaderY).toBeGreaterThanOrEqual(0)
    expect(visibleRow(fixture.tui, `${scenario.label}_DETAIL_01`)).toBe(-1)

    fixture.expand()
    expect(preserveViewport(fixture.tui)).toBe(true)
    expect(fixture.tui.getFocusedComponent()).toBe(fixture.editor)
    fixture.tui.renderNow()

    expect(fixture.scrollView.scrollTop).toBe(beforeTop)
    expect(visibleRow(fixture.tui, `${scenario.label}_HEADER`)).toBe(beforeHeaderY)
    expect(fixture.tui.getScreenLines()[beforeHeaderY + 1]).toContain(`${scenario.label}_DETAIL_01`)
    expect(fixture.tui.getFocusedComponent()).toBe(fixture.editor)

    fixture.input('\x1b[<65;1;1M')
    fixture.tui.renderNow()
    const afterWheelTop = fixture.scrollView.scrollTop
    expect(afterWheelTop).toBeGreaterThan(beforeTop)

    fixture.input('\x1b[6~')
    fixture.tui.renderNow()
    const afterPageTop = fixture.scrollView.scrollTop
    expect(afterPageTop).toBeGreaterThan(afterWheelTop)

    fixture.input('\x1b[8^')
    fixture.tui.renderNow()
    expect(fixture.scrollView.scrollTop).toBeGreaterThanOrEqual(afterPageTop)
    expect(fixture.scrollView.isFollowingEnd).toBe(true)
    expect(fixture.tui.getFocusedComponent()).toBe(fixture.editor)
  } finally {
    fixture.stop()
  }
})

test('collapse clamping does not resume follow on the next streamed rows', () => {
  const terminal = memoryTerminal()
  let lines = Array.from({ length: 40 }, (_, i) => `ROW_${i}`)
  const scroll = new ScrollView(new MutableLines(() => lines), { follow: 'end', primary: true })
  const tui = new TuiAltScreen(terminal.terminal, false)
  tui.setLayoutRoot(new VStack([{ component: scroll, grow: 1, minSize: 0 }]))
  try {
    tui.start()
    tui.renderNow()
    scroll.scrollTo(20, { disableFollow: true })
    expect(preserveViewport(tui)).toBe(true)
    tui.renderNow() // Native layout clears interior suppression here.
    lines = lines.slice(0, 25)
    tui.renderNow() // Collapse clamps 20 to the new maximum, 15.
    const clamped = tui.getScreenLines().slice()
    expect(clamped[0]).toContain('ROW_15')
    lines.push('STREAM_1', 'STREAM_2')
    tui.renderNow()
    expect(tui.getScreenLines()).toEqual(clamped)
    expect(scroll.isFollowingEnd).toBe(false)
    scroll.scrollToEnd()
    tui.renderNow()
    expect(tui.getScreenLines().at(-1)).toContain('STREAM_2')
    expect(scroll.isFollowingEnd).toBe(true)
    expect(Object.hasOwn(scroll, 'updateLayout')).toBe(true)
    expect(new ScrollView(new Text('unrelated')).updateLayout).toBe(
      ScrollView.prototype.updateLayout,
    )
    releaseViewport(tui)
    expect(Object.hasOwn(scroll, 'updateLayout')).toBe(false)
    expect(scroll.updateLayout).toBe(ScrollView.prototype.updateLayout)
  } finally {
    releaseViewport(tui)
    tui.stop()
  }
})

test('unsupported hosts safely no-op without blocking expansion', () => {
  expect(preserveViewport(undefined)).toBe(false)
  expect(preserveViewport({})).toBe(false)

  let regularCalled = false
  expect(
    preserveViewport({
      mode: 'regular',
      getPrimaryScrollView() {
        regularCalled = true
        throw new Error('must not inspect regular mode')
      },
    }),
  ).toBe(false)
  expect(regularCalled).toBe(false)

  expect(preserveViewport({ mode: 'fullscreen', getPrimaryScrollView: 'not callable' })).toBe(false)
  expect(
    preserveViewport({
      mode: 'fullscreen',
      getPrimaryScrollView: () => ({ scrollTop: Number.NaN, scrollTo() {} }),
    }),
  ).toBe(false)
  expect(
    preserveViewport({
      mode: 'fullscreen',
      getPrimaryScrollView: () => ({ scrollTop: 1 }),
    }),
  ).toBe(false)
  expect(
    preserveViewport({
      mode: 'fullscreen',
      getPrimaryScrollView: () => ({
        scrollTop: 1,
        scrollTo() {
          throw new Error('unsupported host shape')
        },
      }),
    }),
  ).toBe(false)

  const calls: unknown[] = []
  expect(
    preserveViewport({
      mode: 'fullscreen',
      getPrimaryScrollView: () => ({
        scrollTop: 3.5,
        scrollTo: (...args: unknown[]) => calls.push(args),
      }),
    }),
  ).toBe(true)
  expect(calls).toEqual([[3.5, { disableFollow: true }]])
})
