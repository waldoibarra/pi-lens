import { beforeAll, expect, test } from 'bun:test'
import { initTheme } from '@earendil-works/pi-coding-agent'
import { Text, visibleWidth, type TuiMouseEvent } from '@earendil-works/pi-tui'
import { theme } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js'
import { HoverController, hoverHeader } from '../src/hover'

beforeAll(() => initTheme('dark', false))
const move = (type: TuiMouseEvent['type'] = 'move'): TuiMouseEvent => ({
  type,
  button: type === 'move' ? 'none' : 'left',
  x: 2,
  y: 0,
  screenX: 12,
  screenY: 10,
  width: 40,
  height: 1,
  shift: false,
  alt: false,
  ctrl: false,
})

test('hover paints the entire clickable line without changing text, geometry, or activation', () => {
  const hover = new HoverController()
  let clicks = 0
  const child = new Text(theme.fg('error', 'Failure details'), 0, 0)
  const header = hoverHeader(child, 'step:a', () => clicks++, theme, hover)
  const base = header.render(40)
  expect(header.handleMouse?.(move())).toBeUndefined()
  const highlighted = header.render(40)
  expect(highlighted).not.toEqual(base)
  expect(highlighted[0]).toContain(theme.fg('error', 'Failure details'))
  expect(visibleWidth(highlighted[0])).toBe(40)
  expect(highlighted).toHaveLength(base.length)
  expect(clicks).toBe(0)
  expect(header.handleMouse?.(move())).toBeUndefined()
  header.handleMouse?.(move('click'))
  expect(clicks).toBe(1)
})

test('hover survives rebuilt headers but never highlights a sibling sharing the same fold action', () => {
  const hover = new HoverController()
  const header = (key: string) =>
    hoverHeader(new Text('Open details', 0, 0), key, () => {}, theme, hover)
  const before = header('run:a:summary').render(40)
  header('run:a:summary').handleMouse?.(move())
  expect(header('run:a:summary').render(40)).not.toEqual(before)
  expect(header('run:a:more').render(40)).toEqual(before)
})

test('observer sees mouse leave before native consumption and never rewrites input', () => {
  const seen: string[] = []
  const native = (data: string) => {
    seen.push(data)
    return { consume: true }
  }
  const later = () => {
    throw new Error('Native consumption remains authoritative')
  }
  const listeners = new Set<Function>([native, later])
  const hover = new HoverController()
  let repaints = 0
  hover.bind({ inputListeners: listeners }, () => repaints++)
  const header = hoverHeader(new Text('Open', 0, 0), 'step:a', () => {}, theme, hover)
  const base = header.render(40)
  header.handleMouse?.(move())
  const deliver = (data: string) => {
    for (const listener of listeners) if (listener(data)?.consume) break
  }
  deliver('\x1b[<35;13;11M')
  expect(header.render(40)).not.toEqual(base)
  expect(repaints).toBe(1)
  deliver('\x1b[<35;1;1M')
  expect(header.render(40)).toEqual(base)
  expect(repaints).toBe(2)
  expect(seen).toEqual(['\x1b[<35;13;11M', '\x1b[<35;1;1M'])
  hover.dispose()
  expect([...listeners]).toEqual([native, later])
})

test('scroll, drag, focus loss and voice keys clear hover without consuming them', () => {
  const hover = new HoverController()
  const listeners = new Set<Function>()
  hover.bind({ inputListeners: listeners }, () => {})
  const observer = [...listeners][0]
  const header = hoverHeader(new Text('Open', 0, 0), 'step:a', () => {}, theme, hover)
  const base = header.render(40)
  for (const input of ['\x1b[<64;13;11M', '\x1b[<32;13;11M', '\x1b[O', ' ', '\x1b']) {
    header.handleMouse?.(move())
    expect(observer(input)).toBeUndefined()
    expect(header.render(40)).toEqual(base)
  }
  for (const type of ['press', 'release', 'drag', 'wheel'] as const) {
    expect(header.handleMouse?.(move(type))).toBeUndefined()
  }
  hover.dispose()
})

test('geometry changes, overlays and disappearing headers clear stale hover without clearing every frame', () => {
  const hover = new HoverController()
  const tui = {
    inputListeners: new Set<Function>(),
    terminal: { columns: 40, rows: 20 },
    viewportTop: 0,
    hasOverlay: () => false,
  }
  hover.bind(tui, () => {})
  const build = () => {
    hover.beginFrame()
    const header = hoverHeader(new Text('Open', 0, 0), 'step:a', () => {}, theme, hover)
    hover.endFrame()
    return header
  }
  const base = build().render(40)
  build().handleMouse?.(move())
  expect(build().render(40)).not.toEqual(base)
  tui.viewportTop = 1
  hover.bind(tui, () => {})
  expect(build().render(40)).toEqual(base)
  build().handleMouse?.(move())
  tui.hasOverlay = () => true
  hover.bind(tui, () => {})
  expect(build().render(40)).toEqual(base)
  build().handleMouse?.(move())
  expect(build().render(40)).toEqual(base)
  tui.hasOverlay = () => false
  hover.bind(tui, () => {})
  build().handleMouse?.(move())
  hover.beginFrame()
  hover.endFrame()
  expect(build().render(40)).toEqual(base)
  hover.dispose()
})

test('renderer rebinding removes only the owned observer and preserves listener order', () => {
  const first = () => {}
  const second = () => {}
  const oldListeners = new Set<Function>([first, second])
  const nextListeners = new Set<Function>([second, first])
  const hover = new HoverController()
  hover.bind({ inputListeners: oldListeners }, () => {})
  hover.bind({ inputListeners: oldListeners }, () => {})
  expect(oldListeners.size).toBe(3)
  hover.bind({ inputListeners: nextListeners }, () => {})
  expect([...oldListeners]).toEqual([first, second])
  expect([...nextListeners].slice(1)).toEqual([second, first])
  hover.dispose()
  hover.dispose()
  expect([...nextListeners]).toEqual([second, first])
})
