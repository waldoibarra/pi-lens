import { expect, test } from 'bun:test'
import lens from '../src/index'
import { Container } from '@earendil-works/pi-tui'
import { initTheme, ToolExecutionComponent } from '@earendil-works/pi-coding-agent'
import { theme } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js'

function harness(mode = 'tui') {
  const handlers = new Map<string, Function[]>()
  const commands = new Map<string, { handler: Function }>()
  const forbidden = () => {
    throw new Error('Lens must not replace tools, editor, or model context')
  }
  const pi = {
    on(name: string, handler: Function) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler])
    },
    registerCommand(name: string, command: { handler: Function }) {
      commands.set(name, command)
    },
    registerTool: forbidden,
    setActiveTools: forbidden,
    sendMessage: forbidden,
    registerShortcut: forbidden,
  }
  const tui = new Container()
  const document = new Container()
  for (let i = 0; i < 3; i++) document.addChild(new Container())
  tui.addChild(document)
  let selectionsCleared = 0
  const scrollPins: unknown[][] = []
  Object.assign(tui, {
    mode: 'fullscreen',
    getPrimaryScrollView: () => ({
      scrollTop: 12,
      scrollTo: (...args: unknown[]) => scrollPins.push(args),
    }),
    requestRender() {},
    resetTextSelection() {
      selectionsCleared++
    },
  })
  const notices: string[] = []
  const working: (string | undefined)[] = []
  let widget: { dispose?(): void } | undefined
  const ctx = {
    mode,
    hasUI: mode === 'tui',
    sessionManager: { getSessionId: () => 'test', getBranch: () => [] },
    ui: {
      theme,
      notify(message: string) {
        notices.push(message)
      },
      setWidget(_key: string, factory: Function | undefined) {
        widget?.dispose?.()
        widget = factory?.(tui, theme)
      },
      setWorkingMessage: forbidden,
      setStatus(key: string, message: string | undefined) {
        expect(key).toBe('pi-lens')
        working.push(message)
      },
      getToolsExpanded() {
        return false
      },
      setEditorComponent: forbidden,
      setFooter: forbidden,
      setHeader: forbidden,
      onTerminalInput: forbidden,
    },
  }
  lens(pi as never)
  const emit = (name: string, event: object) => {
    for (const handler of handlers.get(name) ?? []) handler(event, ctx)
  }
  return {
    handlers,
    commands,
    ctx,
    emit,
    notices,
    working,
    selectionsCleared: () => selectionsCleared,
    scrollPins,
    document,
    chat: document.children[2] as Container,
  }
}

initTheme('dark', false)

test('only observes lifecycle and registers its own command', () => {
  const h = harness()
  expect([...h.commands.keys()]).toEqual(['lens'])
  for (const event of ['tool_call', 'tool_result', 'context', 'message_end']) {
    if (event === 'message_end') continue
    expect(h.handlers.has(event)).toBe(false)
  }
  h.emit('session_start', { reason: 'startup' })
  expect(Object.hasOwn(h.chat, 'render')).toBe(true)
  h.emit('session_shutdown', { reason: 'quit' })
  expect(Object.hasOwn(h.chat, 'render')).toBe(false)
})

test('status, invalid arguments, raw working state, and reload preserve the view', async () => {
  const h = harness()
  h.emit('session_start', { reason: 'startup' })
  await h.commands.get('lens')!.handler('clean', h.ctx)
  expect(h.selectionsCleared()).toBe(1)
  await h.commands.get('lens')!.handler('', h.ctx)
  expect(h.notices.at(-1)).toContain('View: clean')
  await h.commands.get('lens')!.handler('nonsense', h.ctx)
  expect(h.notices.at(-1)).toContain('normal')
  h.emit('tool_execution_start', { toolName: 'read', toolCallId: 'a', args: { path: 'a.ts' } })
  expect(h.working).toEqual([]) // The transcript tail owns activity; no duplicate footer status.
  await h.commands.get('lens')!.handler('raw', h.ctx)
  expect(h.working.at(-1)).toBeUndefined()
  h.emit('session_shutdown', { reason: 'reload' })
  const next = harness()
  next.emit('session_start', { reason: 'reload' })
  await next.commands.get('lens')!.handler('', next.ctx)
  expect(next.notices.at(-1)).toContain('View: raw')
  next.emit('session_shutdown', { reason: 'quit' })
})

test('an unsupported transcript layout retains native rendering and reports unavailable', async () => {
  const h = harness()
  h.document.addChild(new Container())
  const nativeRender = h.chat.render
  const nativeMouse = h.chat.handleMouse
  h.emit('session_start', { reason: 'startup' })
  expect(h.chat.render).toBe(nativeRender)
  expect(h.chat.handleMouse).toBe(nativeMouse)
  expect(h.notices.at(-1)).toContain('Native rendering remains active')
  await h.commands.get('lens')!.handler('normal', h.ctx)
  expect(h.notices.at(-1)).toContain('Lens is unavailable')
  h.emit('session_shutdown', { reason: 'quit' })
})

test('a failed adapter refuses cosmetic recovery until reload', async () => {
  const h = harness()
  h.emit('session_start', { reason: 'startup' })
  const row = new ToolExecutionComponent(
    'read',
    'broken',
    {},
    {},
    undefined,
    { requestRender() {} } as never,
    '/tmp',
  )
  Reflect.deleteProperty(row, 'toolName')
  h.chat.addChild(row)
  h.chat.render(80)
  expect(h.notices.at(-1)).toContain('Native rendering is restored')
  await h.commands.get('lens')!.handler('normal', h.ctx)
  expect(h.notices.at(-1)).toContain('reload')
  h.emit('session_shutdown', { reason: 'quit' })
})

test('disclosure redraw pins the viewport but mode commands do not', async () => {
  const h = harness()
  h.emit('session_start', { reason: 'startup' })
  await h.commands.get('lens')!.handler('normal', h.ctx)
  expect(h.scrollPins).toEqual([])
  const row = new ToolExecutionComponent(
    'read',
    'pin',
    { path: 'pin.txt' },
    {},
    undefined,
    { requestRender() {} } as never,
    '/tmp',
  )
  row.updateResult({ content: [{ type: 'text', text: 'Details' }], isError: false })
  h.chat.addChild(row)
  const lines = h.chat.render(80)
  const y = lines.findIndex((line) => line.includes('Read pin.txt'))
  h.chat.handleMouse({
    type: 'click',
    button: 'left',
    x: 2,
    y,
    screenX: 2,
    screenY: y,
    width: 80,
    height: lines.length,
    shift: false,
    alt: false,
    ctrl: false,
  } as never)
  expect(h.scrollPins).toEqual([[12, { disableFollow: true }]])
  await h.commands.get('lens')!.handler('raw', h.ctx)
  expect(h.scrollPins).toHaveLength(1)
  h.emit('session_shutdown', { reason: 'quit' })
})

test('non-TUI sessions do not install UI or mutate messages', () => {
  const h = harness('json')
  const message = Object.freeze({ role: 'assistant', timestamp: 123, content: Object.freeze([]) })
  h.emit('session_start', { reason: 'startup' })
  h.emit('message_end', { message })
  expect(Object.hasOwn(h.chat, 'render')).toBe(false)
  expect(h.working).toEqual([])
  h.emit('session_shutdown', { reason: 'quit' })
})
