import { beforeAll, expect, test } from 'bun:test'
import {
  AssistantMessageComponent,
  CustomMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
  initTheme,
} from '@earendil-works/pi-coding-agent'
import { Container, Spacer, Text, visibleWidth, rgbColor } from '@earendil-works/pi-tui'
import { theme } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js'
import { LensState } from '../src/state'
import { projectTranscript } from '../src/presentation'
import { hoverFor } from '../src/hover'

beforeAll(() => initTheme('dark', false))
const plain = (lines: string[]) =>
  lines
    .join('\n')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
const ui = { requestRender() {} }
function tool(id: string, name = 'read', text = 'a\nb', error = false) {
  const row = new ToolExecutionComponent(
    name,
    id,
    name === 'read' ? { path: `/project/${id}.ts` } : { command: 'npm test' },
    {},
    undefined,
    ui as never,
    '/project',
  )
  row.updateResult({ content: [{ type: 'text', text }], isError: error })
  return row
}
function render(
  children: Container['children'],
  state: LensState,
  width = 80,
  toolsExpanded = false,
) {
  const container = new Container()
  container.children = projectTranscript(children, state, theme, () => {}, toolsExpanded)
  return { container, text: plain(container.render(width)) }
}
function nativeExpanded(row: ToolExecutionComponent, width = 80) {
  row.setExpanded(true)
  return plain(row.render(width))
}
function observed(count: number) {
  const state = new LensState()
  state.observe({
    role: 'assistant',
    timestamp: 100,
    model: 'gpt-6-astra',
    content: Array.from({ length: count }, (_, i) => ({ type: 'toolCall', id: String(i) })),
  })
  return state
}

test('clickable steps visibly highlight on native mouse motion and survive projection redraw', () => {
  const state = observed(1)
  const row = tool('0')
  const original = render([row], state)
  const lines = original.container.render(80)
  const y = lines.findIndex((line) => line.includes('Read 0.ts'))
  original.container.handleMouse({
    type: 'move',
    button: 'none',
    x: 3,
    y,
    screenX: 3,
    screenY: y,
    width: 80,
    height: lines.length,
    shift: false,
    alt: false,
    ctrl: false,
  } as never)
  const highlighted = render([row], state).container.render(80)
  expect(highlighted[y]).not.toBe(lines[y])
  expect(highlighted[y]).toContain(theme.bg('selectedBg', '').split('\x1b[49m')[0])
  hoverFor(state).clear()
  expect(render([row], state).container.render(80)).toEqual(lines)
})

test('the transcript shows only the latest thinking heading with expandable history', () => {
  const state = new LensState()
  const message = {
    role: 'assistant',
    timestamp: 100,
    model: 'gpt-6-astra',
    stopReason: 'stop',
    content: [
      {
        type: 'thinking',
        thinking: '**First update**\nEarlier detail\n\n**Latest update**\nCurrent detail',
      },
      { type: 'text', text: 'VISIBLE_REPLY' },
    ],
  }
  const row = new AssistantMessageComponent(message as never, false)
  const native = row.render(80)
  const collapsed = render([row], state).text
  expect(collapsed).toContain('▸ Thinking updates · Latest update · 2 updates')
  expect(collapsed).not.toContain('First update')
  expect(collapsed).toContain('VISIBLE_REPLY')
  state.open.add('progress:100:0')
  const opened = render([row], state).text
  expect(opened).toContain('First update')
  expect(opened).toContain('Earlier detail')
  state.view = 'raw'
  expect(render([row], state).container.render(80)).toEqual(native)
})

test('streaming expanded progress invalidates hover when a following tool header moves', () => {
  const state = observed(1)
  state.open.add('progress:100:0')
  const message = {
    role: 'assistant',
    timestamp: 100,
    content: [{ type: 'thinking', thinking: '**Progress**\nDetail' }],
  }
  const assistant = new AssistantMessageComponent(message as never, false)
  const row = tool('0')
  const view = render([assistant, row], state)
  const lines = view.container.render(80)
  const y = lines.findIndex((line) => line.includes('Read 0.ts'))
  view.container.handleMouse({
    type: 'move',
    button: 'none',
    x: 3,
    y,
    screenX: 3,
    screenY: y,
    width: 80,
    height: lines.length,
    shift: false,
    alt: false,
    ctrl: false,
  } as never)
  expect(hoverFor(state).isHovered('step:0')).toBe(true)
  assistant.updateContent(
    {
      ...message,
      content: [{ type: 'thinking', thinking: '**Progress**\nDetail\nMore detail\nAnother line' }],
    } as never,
    true,
  )
  render([assistant, row], state)
  expect(hoverFor(state).isHovered('step:0')).toBe(false)
})

test('reply model stamps use a warm role color while tool stamps stay grey', () => {
  try {
    for (const appearance of ['dark', 'light'] as const) {
      initTheme(appearance, false)
      const state = observed(1)
      const message = {
        role: 'assistant',
        timestamp: 200,
        model: 'gpt-6-astra',
        content: [{ type: 'text', text: 'Finished the checks.' }],
        stopReason: 'stop',
      }
      state.observe(message)
      const before = JSON.stringify(message)
      const lines = render([tool('0'), new AssistantMessageComponent(message as never)], state)
        .container.render(80)
        .filter((line) => line.includes('GPT 6 Astra'))
      expect(lines).toHaveLength(2)
      const toolLabel = plain([lines[0]]).trim()
      const replyLabel = plain([lines[1]]).trim()
      expect(lines[0]).toContain(theme.fg('muted', toolLabel))
      const color = appearance === 'light' ? rgbColor(166, 71, 45) : rgbColor(217, 119, 87)
      expect(lines[1]).toContain(theme.style(replyLabel, { fg: color, bold: true }))
      expect(JSON.stringify(message)).toBe(before)
    }
  } finally {
    initTheme('dark', false)
  }
})

test('normal run totals neither highlight nor toggle, while clean folds still do', () => {
  const state = observed(2)
  const rows = [tool('0'), tool('1')]
  const eventAt = (view: ReturnType<typeof render>, text: string, type: 'move' | 'click') => {
    const lines = view.container.render(80)
    const y = lines.findIndex((line) => line.includes(text))
    expect(y).toBeGreaterThanOrEqual(0)
    view.container.handleMouse({
      type,
      button: type === 'move' ? 'none' : 'left',
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
  }
  eventAt(render(rows, state), 'Read 2 files', 'move')
  expect(hoverFor(state).isHovered('run:0:summary')).toBe(false)
  eventAt(render(rows, state), 'Read 2 files', 'click')
  expect(state.open.has('run:0')).toBe(false)
  state.view = 'clean'
  eventAt(render(rows, state), '2 steps', 'move')
  expect(hoverFor(state).isHovered('run:0:summary')).toBe(true)
  eventAt(render(rows, state), '2 steps', 'click')
  expect(state.open.has('run:0')).toBe(true)
})

test('assistant prose keeps adjacent tool runs separate', () => {
  const state = new LensState()
  state.observe({
    role: 'assistant',
    timestamp: 90,
    model: 'gpt-6-astra',
    content: [{ type: 'toolCall', id: '0' }],
  })
  const message = {
    role: 'assistant',
    timestamp: 91,
    model: 'gpt-6-astra',
    content: [{ type: 'text', text: 'VISIBLE_TOOL_BOUNDARY' }],
    stopReason: 'stop',
  }
  state.observe(message)
  state.observe({
    role: 'assistant',
    timestamp: 92,
    model: 'gpt-6-astra',
    content: [{ type: 'toolCall', id: '1' }],
  })

  const output = render(
    [tool('0'), new AssistantMessageComponent(message as never), tool('1')],
    state,
  ).text
  expect(output).toContain('VISIBLE_TOOL_BOUNDARY')
  expect(output).toContain('Read 0.ts')
  expect(output).toContain('Read 1.ts')
  expect(output).not.toContain('Read 2 files')
})

test('tool cycles after visible work keep historical thinking segments stable', () => {
  const state = new LensState()
  const first = {
    role: 'assistant',
    timestamp: 201,
    stopReason: 'toolUse',
    content: [
      { type: 'thinking', thinking: '**Before first tool**' },
      { type: 'toolCall', id: '0', name: 'read', arguments: { path: '/project/0.ts' } },
    ],
  }
  const second = {
    role: 'assistant',
    timestamp: 202,
    stopReason: 'toolUse',
    content: [
      { type: 'thinking', thinking: '**After first tool**' },
      { type: 'toolCall', id: '1', name: 'read', arguments: { path: '/project/1.ts' } },
    ],
  }
  state.observe(first)
  state.observe(second)
  const children = [
    new AssistantMessageComponent(first as never, true),
    tool('0'),
    new AssistantMessageComponent(second as never, true),
    tool('1'),
  ]
  const closed = render(children, state).text
  expect(closed.match(/Thinking updates/g)).toHaveLength(2)
  expect(closed.indexOf('Before first tool')).toBeLessThan(closed.indexOf('Read 0.ts'))
  expect(closed.indexOf('After first tool')).toBeGreaterThan(closed.indexOf('Read 0.ts'))
  state.open.add('progress:201:0')
  const open = render(children, state).text
  expect(open).toContain('▾ Thinking updates · Before first tool')
  expect(open).toContain('▸ Thinking updates · After first tool')
  expect(open).toContain('• Before first tool')
  expect(open).not.toContain('• After first tool')
})

test.each(['normal', 'clean'] as const)('live activity is an appended inert tail in %s', (view) => {
  const state = observed(2)
  state.view = view
  state.open.add('run:1')
  const message = {
    role: 'assistant',
    timestamp: 202,
    content: [{ type: 'thinking', thinking: '# THINKING_B\nINSPECTABLE_DETAIL' }],
  }
  const thinking = new AssistantMessageComponent(message as never, true)
  thinking.updateContent(message as never, true)
  const notice = new CustomMessageComponent({
    role: 'custom',
    customType: 'notice',
    content: 'ASYNC_NOTICE',
    display: true,
  } as never)
  const children = [tool('0'), thinking, notice]
  state.open.add('progress:202:0')
  let projected = projectTranscript(children, state, theme, () => {})
  expect(plain(projected.at(-1)!.render(80))).toContain('Thinking… · THINKING_B')
  expect(projected.at(-1)!.handleMouse).toBeUndefined()
  expect(render(children, state).text).toContain('INSPECTABLE_DETAIL')
  const running = new ToolExecutionComponent(
    'read',
    '1',
    { path: '/project/1.ts' },
    {},
    undefined,
    ui as never,
    '/project',
  )
  children.push(running)
  projected = projectTranscript(children, state, theme, () => {})
  const text = plain(projected.flatMap((row) => row.render(80)))
  expect(text.indexOf('Read 1.ts')).toBeGreaterThan(text.indexOf('THINKING_B'))
  expect(text).not.toContain('Thinking…')
  expect(text.match(/Running…/g)).toHaveLength(1)
  expect(plain(projected.at(-1)!.render(80))).toContain('Running… · Read 1.ts')
  expect(projected.at(-1)!.handleMouse).toBeUndefined()
  thinking.updateContent(message as never, false)
  running.updateResult({ content: [{ type: 'text', text: 'cancelled' }], isError: true })
  expect(render(children, state).text).not.toMatch(/Thinking…|Running…/)
  state.view = 'raw'
  expect(projectTranscript(children, state, theme, () => {})).toBe(children)
})

test('verified shell spacers disappear without trimming native Markdown or unknown rows', () => {
  const state = new LensState()
  const prose = new AssistantMessageComponent({
    role: 'assistant',
    timestamp: 1,
    content: [{ type: 'text', text: 'PROSE\n\n```txt\nfirst\n\nthird\n```' }],
  } as never)
  const thinking = new AssistantMessageComponent({
    role: 'assistant',
    timestamp: 2,
    content: [{ type: 'thinking', thinking: '# THINK' }],
  } as never)
  const unknown = new Text('\nUNKNOWN\n', 0, 0)
  const native = prose.render(80)
  const children = [prose, new Spacer(1), thinking, unknown, new Spacer(2)]
  const lines = render(children, state).container.render(80)
  expect(plain([lines[0]])).toContain('PROSE')
  const compactProse = render([prose], state).text
  expect(compactProse).toBe(plain(native.slice(1)))
  expect(render([prose, new Spacer(1), thinking], state).text).toBe(
    `${compactProse}\n▸ Thinking updates · THINK`,
  )
  expect(lines.slice(-5)).toEqual([...unknown.render(80), '', ''])
  expect(prose.render(80)).toEqual(native)
})

test('normal groups mixed tools; clean retains the latest failure', () => {
  const children = [
    tool('0'),
    tool('1'),
    tool('2', 'bash', 'npm ERR! missing script\nCommand exited with code 1', true),
  ]
  const state = observed(3)
  const normal = render(children, state).text
  expect(normal).toContain('• Read 2 files, ran 1 command (1 failed)')
  expect(normal).toContain('✓ Read 0.ts · 2 lines')
  expect(normal).toContain('npm ERR! missing script')
  expect(normal).not.toContain('/project/')
  state.view = 'clean'
  const clean = render(children, state).text
  expect(clean).toContain('▸ 3 steps · 1 failed')
  expect(clean).toContain('The command failed (exit 1)')
  expect(clean).not.toContain('Read 0.ts')
  expect(clean).not.toContain('npm ERR!')
})

test('fullscreen click routing opens folds, then the original native command row', () => {
  const state = observed(1)
  state.view = 'clean'
  const row = tool('0', 'bash', 'COMMAND_OUTPUT_SENTINEL')
  const children = [row]
  const click = (container: Container, needle: string) => {
    const lines = container.render(80)
    const y = lines.findIndex((value) => value.includes(needle))
    expect(y).toBeGreaterThanOrEqual(0)
    container.handleMouse({
      type: 'click',
      button: 'left',
      x: 3,
      y,
      screenX: 3,
      screenY: y,
      width: 80,
      height: lines.length,
      shift: false,
      alt: false,
      ctrl: false,
    } as never)
  }
  click(render(children, state).container, '1 step')
  expect(render(children, state).text).toContain('▸ ✓ Ran a shell command')
  click(render(children, state).container, 'Ran a shell command')
  const opened = render(children, state).text
  expect(opened).toContain('▾ ✓ Ran a shell command')
  expect(opened).toContain('COMMAND_OUTPUT_SENTINEL')
  expect(opened).toContain(nativeExpanded(row).trim())
  click(render(children, state).container, 'Ran a shell command')
  expect(render(children, state).text).toContain('▸ ✓ Ran a shell command')
  expect(render(children, state).text).not.toContain('COMMAND_OUTPUT_SENTINEL')
})

test('every Lens-collapsed tool is individually expandable, even old read rows', () => {
  const state = observed(2)
  const children = [tool('0'), tool('1', 'bash', 'Failed', true)]
  let normal = render(children, state).text
  expect(normal).toContain('▸ ✓ Read 0.ts')
  expect(normal).toContain('▸ ✗ Ran a shell command')
  state.observe({
    role: 'assistant',
    timestamp: 200,
    content: Array.from({ length: 650 }, (_, i) => ({ type: 'toolCall', id: `later-${i}` })),
  })
  normal = render(children, state).text
  expect(normal).toContain('▸ ✓ Read 0.ts')
  state.open.add('step:0')
  expect(render(children, state).text).toContain(nativeExpanded(children[0]).trim())
})

test('questions, including waiting questions, expand to the native body', () => {
  const row = new ToolExecutionComponent(
    'ask_user_question',
    'question',
    {},
    {},
    undefined,
    ui as never,
    '/project',
  )
  const state = new LensState()
  expect(render([row], state).text).toContain('▸ ? Waiting for your answer')
  state.open.add('step:question')
  expect(render([row], state).text).toContain(nativeExpanded(row).trim())
  state.open.clear()
  row.updateResult({
    content: [],
    details: {
      questions: [{ question: 'Where?', header: 'Scope' }],
      answers: { 'Where?': 'User' },
    },
  } as never)
  expect(render([row], state).text).toContain('▸ ? Answered Scope: User')
  state.open.add('step:question')
  expect(render([row], state).text).toContain('▾ ? Answered Scope: User')
  expect(render([row], state).text).toContain('Scope: Where?')
})

test('delegated model labels are human-readable in both views', () => {
  const row = tool('0', 'subagent')
  row.updateResult({
    content: [{ type: 'text', text: 'Done' }],
    details: { results: [{ model: 'gpt-6-astra' }] },
  } as never)
  const state = observed(1)
  expect(render([row], state).text).toContain('Delegated to a helper agent · GPT 6 Astra')
  state.view = 'clean'
  state.open.add('run:0')
  expect(render([row], state).text).toContain('Delegated to a helper agent · GPT 6 Astra')
})

test('a single batch shows its observed actions without redundant orchestration headers', () => {
  const row = new ToolExecutionComponent(
    'codemode',
    '0',
    { code: 'await tools.read({path: "a.ts"})' },
    {},
    undefined,
    ui as never,
    '/project',
  )
  row.updateResult({
    content: [{ type: 'text', text: 'BATCH_DETAIL_SENTINEL' }],
    details: {
      calls: [
        { name: 'read', args: '{"path":"a.ts"}', status: 'ok' },
        { name: 'read', args: '{"path":"b.ts"}', status: 'ok' },
      ],
    },
  } as never)
  const state = observed(1)
  const collapsed = render([row], state).text
  expect(collapsed).toContain('▸ ✓ Read a.ts and b.ts')
  expect(collapsed).not.toContain('Codemode')
  expect(collapsed).not.toContain('Took')
  expect(collapsed).not.toContain('• Read 2 files')
  state.open.add('step:0')
  expect(render([row], state).text).toContain('BATCH_DETAIL_SENTINEL')
})

test('retained native choices also survive a reload while raw is selected', () => {
  const state = observed(1)
  state.view = 'raw'
  state.open.add('step:0')
  const replacement = tool('0', 'bash', 'RAW_RELOAD_SENTINEL')
  projectTranscript([replacement], state, theme, () => {})
  expect((replacement as unknown as { expanded: boolean }).expanded).toBe(true)
  expect(state.open.has('step:0')).toBe(true)
})

test('clean failure counts use top-level steps even when a batch has multiple failures', () => {
  const row = new ToolExecutionComponent(
    'codemode',
    '0',
    {},
    {},
    undefined,
    ui as never,
    '/project',
  )
  row.updateResult({
    content: [],
    isError: false,
    details: {
      calls: [
        { name: 'read', args: '{"path":"a.ts"}', status: 'error', error: 'ENOENT' },
        { name: 'read', args: '{"path":"b.ts"}', status: 'error', error: 'ENOENT' },
      ],
    },
  })
  const state = observed(2)
  state.view = 'clean'
  expect(render([row], state).text).toContain('1 step · 1 failed')
  const failure = tool('1', 'bash', 'Command exited with code 2', true)
  expect(render([row, failure], state).text).toContain('2 steps · 2 failed')
})

test('normal keeps the more/fewer toggle fixed after five steps', () => {
  const state = observed(7)
  const children = Array.from({ length: 7 }, (_, i) => tool(String(i)))
  const closed = render(children, state).text.split('\n')
  const more = closed.findIndex((line) => line.includes('+2 more'))
  expect(more).toBeGreaterThanOrEqual(0)
  expect(closed.slice(0, more).filter((line) => line.includes('▸ ✓ Read '))).toHaveLength(5)
  expect(closed.join('\n')).not.toContain('Read 6.ts')

  state.open.add('run:0')
  const open = render(children, state).text.split('\n')
  const fewer = open.findIndex((line) => line.includes('show fewer'))
  expect(fewer).toBe(more)
  expect(open[fewer + 1]).toContain('Read 5.ts')
  expect(open.join('\n')).toContain('Read 6.ts')
})

test('normal exposes a hidden running step after the fixed more toggle', () => {
  const state = observed(7)
  const children = Array.from({ length: 7 }, (_, i) => tool(String(i)))
  ;(children[6] as unknown as { isPartial: boolean }).isPartial = true
  const lines = render(children, state).text.split('\n')
  const more = lines.findIndex((line) => line.includes('+2 more'))
  const running = lines.findIndex((line) => line.includes('… Read 6.ts'))
  expect(more).toBeGreaterThanOrEqual(0)
  expect(running).toBeGreaterThan(more)
})

test('global expansion bypasses Lens and returns the original native children', () => {
  const state = observed(7)
  state.view = 'clean'
  const children = Array.from({ length: 7 }, (_, i) => tool(String(i)))
  expect(projectTranscript(children, state, theme, () => {}, true)).toBe(children)
  expect(render(children, state, 80, true).text).toBe(
    plain(children.flatMap((row) => row.render(80))),
  )
})

test('large native outputs have no old Lens tail caps', () => {
  const row = tool(
    '0',
    'bash',
    Array.from({ length: 2101 }, (_, i) => (i === 2100 ? 'TAIL_SENTINEL' : 'line')).join('\n'),
  )
  const state = observed(1)
  state.open.add('step:0')
  expect(render([row], state).text).toContain('TAIL_SENTINEL')
})

test('native body collapse and raw clicks are reflected in individual open state', () => {
  const row = tool('0', 'bash', 'BODY_SENTINEL')
  const state = observed(1)
  state.open.add('step:0')
  let view = render([row], state)
  let lines = view.container.render(80)
  let y = lines.findIndex((value) => value.includes('bash'))
  expect(y).toBeGreaterThanOrEqual(0)
  view.container.handleMouse({
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
  expect(state.open.has('step:0')).toBe(false)

  state.view = 'raw'
  render([row], state)
  row.setExpanded(true)
  state.view = 'normal'
  expect(render([row], state).text).toContain('BODY_SENTINEL')
  expect(state.open.has('step:0')).toBe(true)
})

test('retained open choices apply to replacement native rows after reload', () => {
  const state = observed(1)
  state.open.add('step:0')
  const replacement = tool('0', 'bash', 'RELOADED_SENTINEL')
  expect(render([replacement], state).text).toContain('RELOADED_SENTINEL')
  expect((replacement as unknown as { expanded: boolean }).expanded).toBe(true)
})

test('global collapse clears individual tool and voice opens without closing run folds', () => {
  const row = tool('0')
  const voice = new CustomMessageComponent({
    role: 'custom',
    customType: 'pi-live-codex-delegation',
    content: 'Voice body',
    details: { delegationId: 'voice-global' },
    timestamp: 1,
    display: true,
  } as never)
  const state = observed(1)
  state.open.add('step:0')
  state.open.add('image-details:0')
  state.open.add('voice:voice-global')
  state.open.add('run:0')
  render([row, voice], state, 80, true)
  render([row, voice], state)
  expect([...state.open].sort()).toEqual(['run:0'])
  expect((row as unknown as { expanded: boolean }).expanded).toBe(false)
  expect((voice as unknown as { _expanded: boolean })._expanded).toBe(false)
})

test('raw leaves original components and their output unchanged', () => {
  const state = observed(1)
  state.view = 'raw'
  const children = [tool('0')]
  expect(projectTranscript(children, state, theme, () => {})).toBe(children)
})

test('unobserved history renders a single step without invented metadata', () => {
  const text = render([tool('old')], new LensState()).text
  expect(text).toContain('✓ Read old.ts')
  expect(text).not.toContain('• Read')
  expect(text).not.toContain('Pi ·')
})

test('voice delegation folds and expands without touching its contents', () => {
  const message = {
    role: 'custom',
    customType: 'pi-live-codex-delegation',
    content: [{ type: 'text', text: 'Inspect the repository.\nKeep all changes private.' }],
    details: { delegationId: 'voice-1', attachments: ['screen.png'] },
    timestamp: 123,
    display: true,
  }
  const before = JSON.stringify(message)
  const row = new CustomMessageComponent(message as never)
  const state = new LensState()
  expect(render([row], state).text).toContain('▸ Voice request: Inspect the repository.')
  expect(render([row], state).text).not.toContain('Keep all changes private.')
  state.open.add('voice:voice-1')
  expect(render([row], state).text).toContain('Keep all changes private.')
  expect((row as unknown as { _expanded: boolean })._expanded).toBe(true)
  expect(JSON.stringify(message)).toBe(before)
})

test('unknown notices remain visible and narrow rows fit', () => {
  const notice = new CustomMessageComponent({
    role: 'custom',
    customType: 'critical-warning',
    content: 'Never hide this warning',
    details: {},
    timestamp: 1,
    display: true,
  } as never)
  const state = observed(1)
  expect(render([notice], state).text).toContain('Never hide this warning')
  for (const width of [1, 8, 20, 80]) {
    const rows = projectTranscript([tool('0')], state, theme, () => {})
    for (const row of rows)
      for (const line of row.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width)
  }
})

test('user-role labels remain neutral while reply labels use observed model metadata', () => {
  const state = new LensState()
  state.observe({ role: 'user', content: 'Again', timestamp: 1 })
  state.observe({ role: 'user', content: 'Again', timestamp: 61_000 })
  const message = {
    role: 'assistant',
    content: [{ type: 'text', text: 'Done' }],
    timestamp: 100,
    model: 'gpt-6-astra',
    stopReason: 'stop',
  }
  state.observe(message)
  const users = [new UserMessageComponent('Again'), new UserMessageComponent('Again')]
  const text = render([...users, new AssistantMessageComponent(message as never)], state).text
  expect(text.match(/Input/g)).toHaveLength(2)
  expect(text).not.toContain('You ·')
  expect(text).toContain('GPT 6 Astra ·')
})

test('unverified automation-like input stays visible without invented attribution', () => {
  const message = Object.freeze({
    role: 'user',
    content: 'Inspect subagent updates above.\nFull instruction remains visible.',
    timestamp: 123,
  })
  const state = new LensState()
  const before = JSON.stringify(message)
  state.observe(message)
  const row = new UserMessageComponent(message.content)
  for (const view of ['normal', 'clean'] as const) {
    state.view = view
    const text = render([row], state).text
    expect(text).toContain('Input')
    expect(text).toContain('Full instruction remains visible.')
    expect(text).not.toContain('You ·')
    expect(text).not.toContain('Agent update')
  }
  expect(JSON.stringify(message)).toBe(before)
})
