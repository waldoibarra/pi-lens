import { beforeAll, expect, test } from 'bun:test'
import {
  AssistantMessageComponent,
  CustomMessageComponent,
  UserMessageComponent,
  initTheme,
  type MarkdownTransformer,
} from '@earendil-works/pi-coding-agent'
import {
  Container,
  MouseRegion,
  Text,
  truncateToWidth,
  visibleWidth,
  stripTerminalSequences,
  type Component,
} from '@earendil-works/pi-tui'
import { theme } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js'
import { projectProgress, type ProgressHeader } from '../src/progress'
import { LensState } from '../src/state'
import { createMermaidMarkdownTransformer } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/mermaid.js'

beforeAll(() => initTheme('dark', false))

const plain = (lines: string[]) => lines.map(stripTerminalSequences).join('\n')

const headerKeys: string[] = []
const header: ProgressHeader = (key, text, activate) => {
  headerKeys.push(key)
  return new MouseRegion(
    {
      render(width) {
        return [truncateToWidth(text, Math.max(0, width))]
      },
      invalidate() {},
    },
    (event) => {
      if (event.type !== 'click' || event.button !== 'left') return undefined
      activate()
      return { handled: true }
    },
  )
}

function assistant(
  timestamp: number,
  content: unknown[],
  options: {
    hide?: boolean
    streaming?: boolean
    stopReason?: string
    errorMessage?: string
    transformers?: MarkdownTransformer[]
  } = {},
) {
  const message = {
    role: 'assistant',
    timestamp,
    content,
    stopReason: options.stopReason,
    errorMessage: options.errorMessage,
  }
  const row = new AssistantMessageComponent(
    message as never,
    options.hide ?? true,
    undefined,
    'Thinking...',
    1,
    options.transformers as never,
  )
  row.updateContent(message as never, options.streaming ?? false)
  return { row, message }
}

function voiceBoundary(id: string) {
  return new CustomMessageComponent({
    customType: 'pi-live-codex-delegation',
    content: 'voice prompt',
    display: true,
    details: { delegationId: id },
  } as never)
}

function render(children: Component[], state = new LensState(), width = 80) {
  headerKeys.length = 0
  let redraws = 0
  const map = projectProgress(children, state, theme, header, () => {
    redraws++
  })
  const container = new Container()
  container.children = children.map((child) => map.get(child) ?? child)
  if (map.activity) container.children.push(new Text(map.activity, 0, 0))
  const lines = container.render(width)
  return { map, container, lines, text: plain(lines), redraws: () => redraws }
}

test('thinking after visible prose starts a separate segment within one assistant row', () => {
  const state = new LensState()
  const row = assistant(100, [
    { type: 'thinking', thinking: '**Plan A**\nold detail' },
    { type: 'text', text: 'VISIBLE_PROSE_ONE' },
    { type: 'thinking', thinking: '# Build B\nmore detail' },
  ]).row

  const collapsed = render([new UserMessageComponent('request'), row], state)
  const first = collapsed.text.indexOf('▸ Thinking updates · Plan A')
  const prose = collapsed.text.indexOf('VISIBLE_PROSE_ONE')
  const second = collapsed.text.indexOf('▸ Thinking updates · Build B')
  expect(first).toBeGreaterThanOrEqual(0)
  expect(prose).toBeGreaterThan(first)
  expect(second).toBeGreaterThan(prose)
  expect(collapsed.text).not.toContain('old detail')
  expect(collapsed.text).not.toContain('more detail')
  expect(headerKeys).toEqual(['progress:100:0', 'progress:100:1'])

  state.open.add('progress:100:1')
  const openedSecond = render([new UserMessageComponent('request'), row], state).text
  expect(openedSecond).toContain('▸ Thinking updates · Plan A')
  expect(openedSecond).toContain('▾ Thinking updates · Build B')
  expect(openedSecond).toContain('• Build B')
  expect(openedSecond).toContain('  more detail')
  expect(openedSecond).not.toContain('old detail')

  state.open.clear()
  state.open.add('progress:100:0')
  const openedFirst = render([new UserMessageComponent('request'), row], state).text
  expect(openedFirst).toContain('▾ Thinking updates · Plan A')
  expect(openedFirst).toContain('▸ Thinking updates · Build B')
  expect(openedFirst).toContain('• Plan A')
  expect(openedFirst).toContain('  old detail')
  expect(openedFirst).not.toContain('more detail')
})

test('a newer unheaded update supersedes an older Markdown heading before prose', () => {
  const first = assistant(250, [{ type: 'thinking', thinking: '**Old phase**\nDetails' }]).row
  const second = assistant(251, [
    { type: 'thinking', thinking: 'Running the final checks\nDetails' },
  ]).row
  const output = render([first, second]).text
  expect(output).toContain('▸ Thinking updates · Running the final checks · 2 updates')
  expect(output).not.toContain('Old phase')
})

test('assistant prose between rows starts a new progress segment below the prose', () => {
  const older = assistant(252, [{ type: 'thinking', thinking: '# Earlier work\nDetails' }]).row
  const prose = assistant(253, [{ type: 'text', text: 'VISIBLE_REPLY_BOUNDARY' }]).row
  const newer = assistant(254, [{ type: 'thinking', thinking: '# Follow-up work\nDetails' }]).row

  const output = render([older, prose, newer]).text
  const earlier = output.indexOf('▸ Thinking updates · Earlier work')
  const reply = output.indexOf('VISIBLE_REPLY_BOUNDARY')
  const followUp = output.indexOf('▸ Thinking updates · Follow-up work')
  expect(earlier).toBeGreaterThanOrEqual(0)
  expect(reply).toBeGreaterThan(earlier)
  expect(followUp).toBeGreaterThan(reply)
  expect(output).not.toContain('Thinking updates · Follow-up work · 2 updates')
})

test('non-heading thinking uses the latest nonempty thinking first line and counts displayed updates', () => {
  const state = new LensState()
  const first = assistant(250, [{ type: 'thinking', thinking: 'reading files\nmore' }]).row
  const second = assistant(251, [{ type: 'thinking', thinking: 'running tests\nmore' }]).row

  const output = render([first, second], state).text
  expect(output).toContain('▸ Thinking updates · running tests · 2 updates')
  expect(output).not.toContain('reading files')
})

test('interleaved prose and native length/error notices stay visible at original positions', () => {
  const state = new LensState()
  const row = assistant(
    300,
    [
      { type: 'thinking', thinking: '# First hidden' },
      { type: 'text', text: 'ANSWER_PROSE' },
      { type: 'thinking', thinking: '# Later hidden' },
    ],
    { stopReason: 'length' },
  ).row

  const output = render([row], state).text
  expect(output).toContain('▸ Thinking updates · First hidden')
  expect(output).toContain('▸ Thinking updates · Later hidden')
  expect(output).toContain('ANSWER_PROSE')
  expect(output).toContain('Response was truncated before completion.')
  const firstHeaderIndex = output.indexOf('First hidden')
  const proseIndex = output.indexOf('ANSWER_PROSE')
  const laterHeaderIndex = output.indexOf('Later hidden')
  const warningIndex = output.indexOf('Response was truncated')
  expect(firstHeaderIndex).toBeLessThan(proseIndex)
  expect(proseIndex).toBeLessThan(laterHeaderIndex)
  expect(laterHeaderIndex).toBeLessThan(warningIndex)

  const errorRow = assistant(301, [], { stopReason: 'error', errorMessage: 'boom' }).row
  expect(render([row, errorRow], state).text).toContain('Error: boom')
})

test('hidden native thinking expands fully without changing original visibility state or message identity', () => {
  const state = new LensState()
  const { row, message } = assistant(
    400,
    [{ type: 'thinking', thinking: '# Secret\nFULL_SECRET_TEXT' }],
    {
      hide: true,
    },
  )
  const internals = row as unknown as {
    hideThinkingBlock: boolean
    lastMessage: unknown
    thinkingVisibilityOverrides: Map<number, boolean>
  }
  const rawBefore = row.render(80)
  expect(plain(rawBefore)).toContain('Thinking...')

  state.open.add('progress:400:0')
  const projected = render([row], state).text
  expect(projected).toContain('Secret')
  expect(projected).toContain('FULL_SECRET_TEXT')
  expect(internals.hideThinkingBlock).toBe(true)
  expect(internals.lastMessage).toBe(message)
  expect(internals.thinkingVisibilityOverrides.size).toBe(0)
  expect(row.render(80)).toEqual(rawBefore)
})

test('raw original render remains byte-equal before and after projected rendering', () => {
  const state = new LensState()
  const row = assistant(500, [
    { type: 'thinking', thinking: '# Hidden' },
    { type: 'text', text: 'Native prose' },
  ]).row
  const before = row.render(72)
  const projection = render([row], state, 72)
  expect(projection.text).toContain('▸ Thinking updates · Hidden')
  expect(row.render(72)).toEqual(before)
})

test('streaming heading renders one noninteractive live indicator and settles to expandable history', () => {
  const state = new LensState()
  const built = assistant(600, [{ type: 'thinking', thinking: '# First' }], { streaming: true })
  const live = render([built.row], state)
  expect(live.text).toContain('Thinking… · First')
  expect(live.text).not.toContain('▸ Thinking…')
  expect(live.text).not.toContain('▾ Thinking…')

  const y = live.lines.findIndex((line) => line.includes('Thinking… · First'))
  expect(y).toBeGreaterThanOrEqual(0)
  live.container.handleMouse({
    type: 'click',
    button: 'left',
    x: 0,
    y,
    screenX: 0,
    screenY: y,
    width: 80,
    height: live.lines.length,
    shift: false,
    alt: false,
    ctrl: false,
  } as never)
  expect(state.open.has('progress:600:0')).toBe(false)

  built.message.content = [{ type: 'thinking', thinking: '# Second\nstream text' }]
  built.row.updateContent(built.message as never, true)
  const streaming = render([built.row], state).text
  expect(streaming).toContain('Thinking… · Second')
  expect(streaming).not.toContain('stream text')

  built.row.updateContent(built.message as never, false)
  const settled = render([built.row], state).text
  expect(settled).toContain('▸ Thinking updates · Second')
  expect(settled).not.toContain('Thinking…')
})

test('multi-segment streaming choices survive native assistant row rebuilds independently', () => {
  const state = new LensState()
  state.open.add('progress:1300:1')
  const content = [
    { type: 'thinking', thinking: '# First segment\nFIRST_DETAIL' },
    { type: 'text', text: 'VISIBLE_REPLY_BOUNDARY' },
    { type: 'thinking', thinking: '# Second segment\nSECOND_DETAIL_STREAMING' },
  ]
  const first = assistant(1300, content, { streaming: true }).row

  const streaming = render([first], state).text
  expect(streaming).toContain('▸ Thinking updates · First segment')
  expect(streaming).toContain('VISIBLE_REPLY_BOUNDARY')
  expect(streaming).toContain('Thinking… · Second segment')
  expect(streaming).not.toContain('▾ Thinking…')
  expect(streaming).not.toContain('FIRST_DETAIL')
  expect(streaming).toContain('▾ Thinking updates · Second segment')
  expect(streaming).toContain('SECOND_DETAIL_STREAMING')

  const rebuilt = assistant(
    1300,
    [
      { type: 'thinking', thinking: '# First segment\nFIRST_DETAIL_REBUILT' },
      { type: 'text', text: 'VISIBLE_REPLY_BOUNDARY' },
      { type: 'thinking', thinking: '# Second segment rebuilt\nSECOND_DETAIL_REBUILT' },
    ],
    { streaming: false },
  ).row
  const reloaded = render([rebuilt], state).text
  expect(state.open.has('progress:1300:1')).toBe(true)
  expect(reloaded).toContain('▸ Thinking updates · First segment')
  expect(reloaded).not.toContain('FIRST_DETAIL_REBUILT')
  expect(reloaded).toContain('▾ Thinking updates · Second segment rebuilt')
  expect(reloaded).toContain('SECOND_DETAIL_REBUILT')
})

test('user and live voice delegation boundaries create separate progress groups', () => {
  const state = new LensState()
  const first = assistant(700, [{ type: 'thinking', thinking: '# First request' }]).row
  const second = assistant(800, [{ type: 'thinking', thinking: '# Voice request' }]).row

  const output = render(
    [new UserMessageComponent('request'), first, voiceBoundary('voice-1'), second],
    state,
  ).text
  expect(output).toContain('▸ Thinking updates · First request')
  expect(output).toContain('▸ Thinking updates · Voice request')
  expect(headerKeys).toContain('progress:700:0')
  expect(headerKeys).toContain('progress:800:0')

  state.open.add('progress:700:0')
  const opened = render(
    [new UserMessageComponent('request'), first, voiceBoundary('voice-1'), second],
    state,
  ).text
  expect(opened).toContain('▾ Thinking updates · First request')
  expect(opened).toContain('▸ Thinking updates · Voice request')
})

test('custom Markdown transformers fall back to whole-run native rendering with error isolation', () => {
  const state = new LensState()
  state.open.add('progress:900:0')
  const throwing = () => {
    throw new Error('broken transformer')
  }
  const wholeRun = (markdown: string, context: { messageType: string }) =>
    context.messageType === 'assistant-thinking' &&
    markdown.includes('# Native transformer') &&
    markdown.includes('# Later transformer')
      ? `WHOLE_CONTEXT\n${markdown}`
      : markdown
  const row = assistant(
    900,
    [{ type: 'thinking', thinking: '# Native transformer\n\n# Later transformer' }],
    {
      transformers: [throwing, wholeRun],
    },
  ).row

  const text = render([row], state).text
  expect(text).toContain('WHOLE_CONTEXT')
  expect(text).toContain('Native transformer')
  expect(text).toContain('Later transformer')
  expect(text).not.toContain('• Native transformer')
})

test('fence-aware segmentation ignores fake headings and preserves preface, paragraphs, and code whitespace', () => {
  const state = new LensState()
  state.open.add('progress:901:0')
  const row = assistant(901, [
    {
      type: 'thinking',
      thinking:
        'Preface line\n\n```ts\n# not a heading\n**not bold heading**\n```\n\n# Real heading\nParagraph one.\n\nParagraph two.\n\n    # indented code heading\n\n~~~\n# still code\n\n# unfinished code stays code',
    },
  ]).row

  const text = render([row], state).text
  expect(text).toContain('▾ Thinking updates · Real heading · 2 updates')
  expect(text).toContain('• Preface line')
  expect(text).toContain('• Real heading')
  expect(text).toContain('  Paragraph one.')
  expect(text).toContain('  Paragraph two.')
  expect(text).toContain('    # indented code heading')
  expect(text).toContain('# unfinished code stays code')
  expect(text).not.toContain('not a heading ·')
})

test('compact expanded thinking labels are unstyled while body Markdown remains native', () => {
  const state = new LensState()
  state.open.add('progress:949:0')
  const row = assistant(949, [
    { type: 'thinking', thinking: '# Compact label\n\nBody **keeps bold**' },
  ]).row

  const lines = render([row], state).lines
  const label = lines.find((line) => line.includes('• Compact label'))
  const body = lines.find((line) => line.includes('keeps bold'))
  expect(label).toBeDefined()
  expect(label!).toContain('• Compact label')
  expect(label!).not.toContain('\x1b[')
  expect(body).toBeDefined()
  expect(body!).toContain('\x1b[')
})

test('expanded thinking labels wrap without losing long Unicode trailing sentinels', () => {
  const state = new LensState()
  state.open.add('progress:954:0')
  const sentinel = '尾部🧪END'
  const title = `# Expanded labels keep wrapping until the final ${sentinel}`
  const row = assistant(954, [{ type: 'thinking', thinking: title }]).row

  const lines = render([row], state, 32).lines
  const firstLabel = lines.findIndex((line) => line.includes('• Expanded labels'))
  const lastLabel = lines.findIndex((line) => line.includes(sentinel))
  expect(firstLabel).toBeGreaterThanOrEqual(0)
  expect(lastLabel).toBeGreaterThan(firstLabel)
  expect(plain(lines)).toContain(sentinel)
  for (const line of lines.slice(firstLabel, lastLabel + 1)) {
    expect(line).not.toContain('\x1b[')
    expect(visibleWidth(line)).toBeLessThanOrEqual(32)
  }
})

test('hidden thinking-only rows do not leave accumulated blank lines', () => {
  const older = assistant(948, [{ type: 'thinking', thinking: '# Older' }]).row
  const newer = assistant(949, [{ type: 'thinking', thinking: '# Newer' }]).row

  const lines = plain(render([older, newer]).lines).split('\n')
  expect(lines).toContain('▸ Thinking updates · Newer · 2 updates')
  expect(lines.at(-1)).not.toBe('')
})

test('Pi default thinking-inert Mermaid transformer does not disable tight bullets', () => {
  const state = new LensState()
  state.open.add('progress:950:0')
  const row = assistant(950, [{ type: 'thinking', thinking: '**First**\n\n**Second**' }], {
    transformers: [createMermaidMarkdownTransformer({ getMode: () => 'final' })],
  }).row
  const lines = render([row], state).text.split('\n')
  const first = lines.findIndex((line) => line.includes('• First'))
  expect(first).toBeGreaterThanOrEqual(0)
  expect(lines[first + 1]).toContain('• Second')
})

test('tight bullets survive native cache hits without rerunning whole-document transformers', () => {
  const state = new LensState()
  state.open.add('progress:953:0')
  const calls: { text: string; type: string; streaming: boolean; width: number }[] = []
  const source = '**First**\n\n**Second**'
  const observe: MarkdownTransformer = (text, context) => {
    calls.push({
      text,
      type: context.messageType,
      streaming: context.isStreaming,
      width: context.availableWidth,
    })
    return text
  }
  const row = assistant(953, [{ type: 'thinking', thinking: source }], {
    transformers: [createMermaidMarkdownTransformer({ getMode: () => 'final' }), observe],
  }).row
  const view = render([row], state)
  expect(view.text).toContain('• First')
  const count = calls.length
  expect(plain(view.container.render(80))).toBe(view.text)
  expect(calls).toHaveLength(count)
  expect(
    calls.every(
      (call) => call.text === source && call.type === 'assistant-thinking' && call.width === 78,
    ),
  ).toBe(true)
})

test('list-contained code fences never become progress headings', () => {
  const state = new LensState()
  state.open.add('progress:951:0')
  const row = assistant(951, [
    { type: 'thinking', thinking: '# First\n- ```md\n  # fake\n  ```\n# Last' },
  ]).row
  const output = render([row], state).text
  expect(output).toContain('Thinking updates · Last · 2 updates')
  expect(output).toContain('# fake')
  expect(output).not.toContain('Thinking updates · fake')
})

test('unheaded structured thinking retains its first source line when expanded', () => {
  const cases = [
    {
      id: 955,
      source: '```ts\nconsole.log("CODE_FIRST_SENTINEL")\n```\nAFTER_CODE_SENTINEL',
      retainedNative: (lines: string[]) =>
        lines.some((line) => line.startsWith('  AFTER_CODE_SENTINEL')),
    },
    {
      id: 956,
      source: '- LIST_FIRST_SENTINEL\n  continuation',
      retainedNative: (lines: string[]) =>
        lines.some((line) => line.startsWith('  - LIST_FIRST_SENTINEL')),
    },
    {
      id: 957,
      source: '> BLOCKQUOTE_FIRST_SENTINEL\n> continuation',
      retainedNative: (lines: string[]) =>
        lines.some((line) => line.startsWith('  │ BLOCKQUOTE_FIRST_SENTINEL')),
    },
  ]

  for (const item of cases) {
    const state = new LensState()
    state.open.add(`progress:${item.id}:0`)
    const row = assistant(item.id, [{ type: 'thinking', thinking: item.source }]).row
    const lines = plain(render([row], state).lines).split('\n')
    expect(item.retainedNative(lines)).toBe(true)
  }
})

test('shortcut references with blockquote definitions retain whole-document link resolution', () => {
  const state = new LensState()
  state.open.add('progress:952:0')
  const row = assistant(952, [
    {
      type: 'thinking',
      thinking: '# First\nSee [guide].\n\n# Second\n> [guide]: https://example.com',
    },
  ]).row
  const output = render([row], state).text
  expect(output).not.toContain('[guide]')
  expect(output).toContain('guide')
  expect(output).not.toContain('• First')
})

test('expanded ordinary heading updates are tight adjacent bullets without added blank rows', () => {
  const state = new LensState()
  state.open.add('progress:902:0')
  const row = assistant(902, [{ type: 'thinking', thinking: '# First\n# Second' }]).row

  const lines = plain(render([row], state).lines).split('\n')
  const firstIndex = lines.findIndex((line) => line.includes('• First'))
  const secondIndex = lines.findIndex((line) => line.includes('• Second'))
  expect(firstIndex).toBeGreaterThanOrEqual(0)
  expect(secondIndex).toBe(firstIndex + 1)
})

test('streaming activity depends on the last relevant content block, not streaming alone', () => {
  const active = assistant(903, [{ type: 'thinking', thinking: '# Still thinking' }], {
    streaming: true,
  }).row
  expect(render([active]).text).toContain('Thinking… · Still thinking')
  expect(render([active]).text).not.toContain('▸ Thinking…')

  const reply = assistant(
    904,
    [
      { type: 'thinking', thinking: '# Done thinking' },
      { type: 'text', text: 'reply started' },
    ],
    { streaming: true },
  ).row
  expect(render([reply]).text).toContain('▸ Thinking updates · Done thinking')
  expect(render([reply]).text).not.toContain('Thinking…')

  const tool = assistant(
    905,
    [
      { type: 'thinking', thinking: '# Tool next' },
      { type: 'toolCall', id: 'call-1', name: 'read', arguments: {} },
    ],
    { streaming: true },
  ).row
  expect(render([tool]).text).toContain('▸ Thinking updates · Tool next')
  expect(render([tool]).text).not.toContain('Thinking…')
})

test('newer reply activity prevents earlier streaming thinking from keeping the group active', () => {
  const older = assistant(906, [{ type: 'thinking', thinking: '# Older thinking' }], {
    streaming: true,
  }).row
  const newer = assistant(907, [
    { type: 'thinking', thinking: '# Newer thinking' },
    { type: 'text', text: 'answer now' },
  ]).row

  const text = render([older, newer]).text
  expect(text).toContain('▸ Thinking updates · Newer thinking · 2 updates')
  expect(text).not.toContain('Thinking…')
})

test('assistant rows without thinking remain native until thinking text exists', () => {
  const row = assistant(908, [{ type: 'text', text: 'plain reply' }], { streaming: true }).row
  const projected = render([row])
  expect(projected.map.has(row)).toBe(false)
  expect(projected.text).not.toContain('Thinking updates')
})

test('reference-style Markdown falls back to unsplit whole-run context', () => {
  const state = new LensState()
  state.open.add('progress:909:0')
  const row = assistant(909, [
    {
      type: 'thinking',
      thinking: '# First\nA [shared][id] link.\n\n# Second\n[id]: https://example.com',
    },
  ]).row

  const text = render([row], state).text
  expect(text).toContain('First')
  expect(text).toContain('Second')
  expect(text).not.toContain('• First')
})

test('narrow unicode headers fit the terminal width', () => {
  const row = assistant(1000, [
    { type: 'thinking', thinking: '# 🔧 修复 very very very long progress heading' },
  ]).row
  const lines = render([row], new LensState(), 12).lines
  expect(lines.length).toBeGreaterThan(0)
  for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(12)
})

test('unsupported private assistant shapes fall back to native rendering', () => {
  const row = assistant(1100, [{ type: 'thinking', thinking: '# Native only' }]).row
  const internals = row as unknown as { contentContainer: Container }
  internals.contentContainer.children.push(
    new MouseRegion(new Text('extra region', 0, 0), () => undefined),
  )

  const state = new LensState()
  const output = render([row], state).text
  expect(output).toContain('Thinking...')
  expect(output).not.toContain('Native only')
  expect(headerKeys).not.toContain('progress:1100')
})

test('header activation toggles persisted state and redraws', () => {
  const state = new LensState()
  const row = assistant(1200, [{ type: 'thinking', thinking: '# Clickable' }]).row
  const projected = render([row], state)
  const y = projected.lines.findIndex((line) => line.includes('Clickable'))
  expect(y).toBeGreaterThanOrEqual(0)
  const result = projected.container.handleMouse({
    type: 'click',
    button: 'left',
    x: 0,
    y,
    screenX: 0,
    screenY: y,
    width: 80,
    height: projected.lines.length,
    shift: false,
    alt: false,
    ctrl: false,
  } as never)
  expect(result?.handled).toBe(true)
  expect(state.open.has('progress:1200:0')).toBe(true)
  expect(projected.redraws()).toBe(1)
})
