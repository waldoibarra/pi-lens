import { stripVTControlCharacters } from 'node:util'
import {
  AssistantMessageComponent,
  CustomMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
  SkillInvocationMessageComponent,
  type Theme,
} from '@earendil-works/pi-coding-agent'
import {
  Container,
  Text,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  rgbColor,
  type Component,
} from '@earendil-works/pi-tui'
import {
  cleanFoldLine,
  normalRunLine,
  statusGlyph,
  stepKind,
  modelName,
  formatTime,
  NORMAL_MAX_STEPS,
  type LensStep,
  type Fold,
} from './domain'
import { toStep, questionData, type ToolData } from './pi-data'
import { LensState, record, textOf } from './state'
import { hoverFor, hoverHeader } from './hover'
import { projectProgress } from './progress'
import { compactMessageShell, isMessageShell, isMessageSpacer } from './spacing'
import { inputBinding, type InputBinding } from './adapter'
import { clipboardInput, invalidateClipboardProjection } from './clipboard'
import {
  disclosureBody,
  hasNativeImageReadContent,
  isNativeImageReadResult,
  nativeImageDisclosureBody,
  nativeImageReadParts,
  reconcileDisclosures,
  setNativeExpanded,
  type DisclosureEntry,
  type NativeDisclosureRow,
} from './disclosure'

type ToolRow = Component & ToolData & NativeDisclosureRow

const TAG_CYAN_DARK = rgbColor(34, 211, 238)
const TAG_CYAN_LIGHT = rgbColor(8, 145, 178)
const VOICE_PURPLE_DARK = rgbColor(196, 181, 253)
const VOICE_PURPLE_LIGHT = rgbColor(126, 34, 206)
const COMPOSER_EMERALD_DARK = rgbColor(52, 211, 153)
const COMPOSER_EMERALD_LIGHT = rgbColor(4, 120, 87)

type Tone = 'muted' | 'error' | 'accent' | 'cyan' | 'purple' | 'emerald'

function toneColor(theme: Theme, tone: Tone) {
  switch (tone) {
    case 'cyan':
      return theme.appearance === 'light' ? TAG_CYAN_LIGHT : TAG_CYAN_DARK
    case 'purple':
      return theme.appearance === 'light' ? VOICE_PURPLE_LIGHT : VOICE_PURPLE_DARK
    case 'emerald':
      return theme.appearance === 'light' ? COMPOSER_EMERALD_LIGHT : COMPOSER_EMERALD_DARK
    default:
      return undefined
  }
}

const stepCache = new WeakMap<
  ToolRow,
  {
    result: ToolRow['result']
    args: unknown
    partial: boolean
    stamp: string
    step: LensStep
  }
>()
function normalized(row: ToolRow, state: LensState): LensStep {
  const stamp = state.calls.get(row.toolCallId)
  const stampKey = stamp ? `${stamp.turn}:${stamp.run}:${stamp.at}:${stamp.model}` : ''
  const cached = stepCache.get(row)
  if (
    cached &&
    cached.result === row.result &&
    cached.args === row.args &&
    cached.partial === row.isPartial &&
    cached.stamp === stampKey
  )
    return cached.step
  const step = toStep(row, stamp)
  stepCache.set(row, {
    result: row.result,
    args: row.args,
    partial: row.isPartial,
    stamp: stampKey,
    step,
  })
  return step
}

function stack(...children: Component[]): Container {
  const container = new Container()
  container.children = children
  return container
}

function line(text: string, theme: Theme, tone: Tone = 'muted', right = false): Component {
  return {
    render(width) {
      const safe = stripVTControlCharacters(text)
        .replace(/[\r\n\t]/g, ' ')
        .replace(/[\x00-\x1f\x7f]/g, '')
      const value = truncateToWidth(safe, Math.max(0, width))
      const padding = right ? ' '.repeat(Math.max(0, width - visibleWidth(value))) : ''
      const color = toneColor(theme, tone)
      const styled = color
        ? theme.style(value, { fg: color, bold: true })
        : theme.fg(tone as 'muted' | 'error' | 'accent', value)
      return [padding + styled]
    },
    invalidate() {},
  }
}

function wrappedLine(text: string, theme: Theme, tone: Tone = 'muted'): Component {
  return {
    render(width) {
      const safe = stripVTControlCharacters(text)
        .replace(/[\r\t]/g, ' ')
        .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      const color = toneColor(theme, tone)
      return wrapTextWithAnsi(safe, Math.max(0, width)).map((value) =>
        color
          ? theme.style(value, { fg: color, bold: true })
          : theme.fg(tone as 'muted' | 'error' | 'accent', value),
      )
    },
    invalidate() {},
  }
}

function clickable(
  child: Component,
  key: string,
  state: LensState,
  redraw: () => void,
  theme: Theme,
  control = 'summary',
): Component {
  return hoverHeader(
    child,
    `${key}:${control}`,
    () => {
      state.toggle(key)
      redraw()
    },
    theme,
    hoverFor(state),
  )
}

function disclosureHeader(
  child: Component,
  key: string,
  row: NativeDisclosureRow,
  state: LensState,
  redraw: () => void,
  theme: Theme,
): Component {
  return hoverHeader(
    child,
    key,
    () => {
      state.toggle(key)
      setNativeExpanded(row, state.open.has(key))
      redraw()
    },
    theme,
    hoverFor(state),
  )
}

function footer(
  at: number | undefined,
  model: string | undefined,
  theme: Theme,
  role: 'user' | 'reply' | 'tools' | 'voice' = 'tools',
  inputLabel = 'Input',
): Component {
  const label = `${role === 'user' || role === 'voice' ? inputLabel : modelName(model)}${at === undefined ? '' : ` · ${formatTime(at, null)}`}`
  const tone =
    role === 'reply' || role === 'tools'
      ? 'cyan'
      : role === 'voice'
        ? 'purple'
        : inputLabel === 'You'
          ? 'emerald'
          : 'muted'
  return line(label, theme, tone, true)
}

function stepRow(
  row: ToolRow,
  step: LensStep,
  state: LensState,
  theme: Theme,
  redraw: () => void,
): Component {
  const facts = [
    step.agentModel ? modelName(step.agentModel) : undefined,
    state.view === 'clean' ? undefined : step.detail,
  ].filter(Boolean)
  const key = `step:${step.id}`
  const indicator = state.open.has(key) ? '▾' : '▸'
  const title = `  ${indicator} ${statusGlyph(step.status)} ${step.label}${facts.length ? ` · ${facts.join(' · ')}` : ''}`
  const label = line(title, theme, step.status === 'error' ? 'error' : 'muted')
  const children = [disclosureHeader(label, key, row, state, redraw, theme)]
  if (step.error) children.push(line(`    ${step.error}`, theme, 'error'))
  if (state.view !== 'clean' && step.rawError) children.push(line(`    ${step.rawError}`, theme))
  if (state.open.has(key)) {
    const detailsKey = `image-details:${step.id}`
    const detailsOpen = state.open.has(detailsKey)
    const detailsHeader = clickable(
      line(`    ${detailsOpen ? '▾' : '▸'} Details`, theme),
      detailsKey,
      state,
      redraw,
      theme,
      'summary',
    )
    children.push(
      nativeImageReadParts(row)
        ? nativeImageDisclosureBody(row, key, detailsKey, state, redraw, detailsHeader)
        : disclosureBody(row, key, state, redraw),
    )
  }
  return stack(...children)
}

function foldRows(rows: ToolRow[], state: LensState, theme: Theme, redraw: () => void): Component {
  const steps = rows.map((row) => normalized(row, state))
  const failed = steps.filter(
    (step) => (step.failedActions ?? (step.status === 'error' ? 1 : 0)) > 0,
  )
  const fold: Fold = {
    steps,
    failed:
      state.view === 'clean'
        ? failed.length
        : failed.reduce((sum, step) => sum + (step.failedActions ?? 1), 0),
    running: steps.some((step) => step.status === 'running'),
    lastError: failed.at(-1)?.error,
  }
  const first = steps[0]
  const key = `run:${first.id}`
  const open = state.open.has(key)
  const clean = state.view === 'clean'
  if (!clean && rows.length === 1) {
    return stack(
      stepRow(rows[0], first, state, theme, redraw),
      footer(first.at, first.model, theme),
    )
  }
  const rowById = new Map(rows.map((row) => [row.toolCallId, row]))
  const children: Component[] = [
    clean
      ? clickable(line(cleanFoldLine(fold, open), theme), key, state, redraw, theme)
      : line(normalRunLine(fold), theme),
  ]
  const pushStep = (step: LensStep) => {
    const row = rowById.get(step.id)
    if (row) children.push(stepRow(row, step, state, theme, redraw))
  }
  if (clean) {
    if (open) for (const step of steps) pushStep(step)
  } else {
    const prefix = steps.slice(0, NORMAL_MAX_STEPS)
    for (const step of prefix) pushStep(step)
    if (steps.length > NORMAL_MAX_STEPS) {
      children.push(
        clickable(
          line(open ? '  show fewer' : `  +${steps.length - NORMAL_MAX_STEPS} more`, theme),
          key,
          state,
          redraw,
          theme,
          open ? 'fewer' : 'more',
        ),
      )
      if (open) {
        for (const step of steps.slice(NORMAL_MAX_STEPS)) pushStep(step)
      } else {
        const running = steps.slice(NORMAL_MAX_STEPS).find((step) => step.status === 'running')
        if (running) pushStep(running)
      }
    }
  }
  if (clean && !open && fold.lastError) children.push(line(`  ✗ ${fold.lastError}`, theme, 'error'))
  children.push(footer(first.at, first.model, theme))
  return stack(...children)
}

function toolFallback(row: ToolRow, state: LensState, theme: Theme, redraw: () => void): Component {
  const question = questionData(row)
  if (question) {
    const key = `step:${row.toolCallId}`
    const title = `${state.open.has(key) ? '▾' : '▸'} ${question.line}`
    const label = line(title, theme)
    const children = [disclosureHeader(label, key, row, state, redraw, theme)]
    if (state.open.has(key)) {
      for (const pair of question.pairs) {
        children.push(new Text(`${pair.header}: ${pair.question}\n→ ${pair.answer}`, 2, 0))
      }
      children.push(disclosureBody(row, key, state, redraw))
    }
    return stack(...children)
  }
  const step = normalized(row, state)
  if (step.kind === 'question') return row
  // Like Claude Lens, steps observed before loading lack folds and timing labels.
  const key = `step:${row.toolCallId}`
  const children = [
    disclosureHeader(
      line(`${state.open.has(key) ? '▾' : '▸'} ${statusGlyph(step.status)} ${step.label}`, theme),
      key,
      row,
      state,
      redraw,
      theme,
    ),
  ]
  if (step.error) children.push(line(`  ${step.error}`, theme, 'error'))
  if (state.open.has(key)) {
    const detailsKey = `image-details:${row.toolCallId}`
    const detailsOpen = state.open.has(detailsKey)
    const detailsHeader = clickable(
      line(`  ${detailsOpen ? '▾' : '▸'} Details`, theme),
      detailsKey,
      state,
      redraw,
      theme,
      'summary',
    )
    children.push(
      nativeImageReadParts(row)
        ? nativeImageDisclosureBody(row, key, detailsKey, state, redraw, detailsHeader)
        : disclosureBody(row, key, state, redraw),
    )
  }
  return stack(...children)
}

type VoiceItem = {
  row: Component & NativeDisclosureRow
  message: Record<string, unknown>
  delegationId: string
  source: string
  at?: number
  preview: string
  attachments: number
}

type VoiceGroup = {
  rows: VoiceItem[]
  key: string
}

function voiceSource(delegationId: string, at?: number): string {
  const encodedId = encodeURIComponent(delegationId)
  return at === undefined ? encodedId : `${encodedId}@${at}`
}

function voiceItem(row: Component): VoiceItem | undefined {
  if (!(row instanceof CustomMessageComponent)) return undefined
  const native = row as unknown as Component & NativeDisclosureRow & { message?: unknown }
  const message = record(native.message)
  if (message.customType !== 'pi-live-codex-delegation') return undefined
  const data = record(message.details)
  if (typeof data.delegationId !== 'string') return undefined
  const at =
    typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)
      ? message.timestamp
      : undefined
  return {
    row: native,
    message,
    delegationId: data.delegationId,
    source: voiceSource(data.delegationId, at),
    at,
    preview: textOf(message.content).trim().split('\n')[0].replace(/\s+/g, ' '),
    attachments: Array.isArray(data.attachments) ? data.attachments.length : 0,
  }
}

function voiceGroups(children: Component[]): Map<Component, VoiceGroup> {
  const byRow = new Map<Component, VoiceGroup>()
  for (let index = 0; index < children.length;) {
    const first = voiceItem(children[index]!)
    if (!first) {
      index++
      continue
    }
    const rows = [first]
    index++
    while (index < children.length) {
      const next = voiceItem(children[index]!)
      if (next) {
        rows.push(next)
        index++
        continue
      }
      if (isMessageSpacer(children[index])) {
        const afterSpacer = voiceItem(children[index + 1]!)
        if (afterSpacer) {
          rows.push(afterSpacer)
          index += 2
          continue
        }
      }
      break
    }
    const key = `voice:${rows.map((item) => item.source).join('|')}`
    const group = { rows, key }
    for (const item of rows) byRow.set(item.row, group)
  }
  return byRow
}

function voiceGroupRow(
  group: VoiceGroup,
  state: LensState,
  theme: Theme,
  redraw: () => void,
): Component {
  const open = state.open.has(group.key)
  const first = group.rows[0]!
  const attachments = group.rows.reduce((sum, item) => sum + item.attachments, 0)
  const count = group.rows.length > 1 ? `${group.rows.length} requests` : 'Voice request'
  const title = `${open ? '▾' : '▸'} ${count}: ${first.preview || '(attachments)'}${attachments ? ` · ${attachments} attachments` : ''}`
  const header = hoverHeader(
    line(title, theme, 'purple'),
    `${group.key}:summary`,
    () => {
      state.toggle(group.key)
      for (const item of group.rows) setNativeExpanded(item.row, state.open.has(group.key))
      redraw()
    },
    theme,
    hoverFor(state),
  )
  const children: Component[] = [header]
  if (open) {
    for (const item of group.rows) children.push(disclosureBody(item.row, group.key, state, redraw))
  }
  children.push(footer(group.rows.at(-1)?.at, undefined, theme, 'voice', 'You'))
  return stack(...children)
}

type InputGroup = InputBinding & { rows: Component[] }

function inputGroups(children: Component[]): Map<Component, InputGroup> {
  const byMessage = new Map<object, InputGroup>()
  const byRow = new Map<Component, InputGroup>()
  const byId = new Map<string, InputGroup>()
  const conflicted = new Set<InputGroup>()
  for (const row of children) {
    const binding = inputBinding(row)
    if (!binding) continue
    let group = byMessage.get(binding.message)
    if (!group) {
      group = { ...binding, rows: [] }
      byMessage.set(binding.message, group)
      if (binding.input) {
        const other = byId.get(binding.input.id)
        if (other) {
          conflicted.add(other)
          conflicted.add(group)
        } else byId.set(binding.input.id, group)
      }
    } else if (
      group.input?.id !== binding.input?.id ||
      group.input?.origin !== binding.input?.origin ||
      group.entryId !== binding.entryId ||
      JSON.stringify(group.clipboard) !== JSON.stringify(binding.clipboard)
    ) {
      conflicted.add(group)
    }
    group.rows.push(row)
    byRow.set(row, group)
  }
  for (const group of conflicted) {
    group.input = undefined
    group.clipboard = undefined
  }
  // Unexpected interleaving must not move native rows across prose, tools, or approvals.
  for (const group of byMessage.values()) {
    const first = children.indexOf(group.rows[0])
    const last = children.indexOf(group.rows.at(-1)!)
    const span = children.slice(first, last + 1)
    if (span.some((row) => byRow.get(row) !== group && !isMessageSpacer(row))) {
      for (const row of group.rows) byRow.delete(row)
    } else {
      group.rows = span
      for (const row of span) byRow.set(row, group)
    }
  }
  return byRow
}

function inputRow(
  group: InputGroup,
  state: LensState,
  theme: Theme,
  redraw: () => void,
  globalExpanded = false,
): Component {
  const at = typeof group.message.timestamp === 'number' ? group.message.timestamp : undefined
  if (group.input?.origin !== 'extension')
    return stack(
      ...(clipboardInput(
        group.rows,
        group,
        state,
        theme,
        (label, key) =>
          clickable(
            { render: (width) => line(label(), theme).render(width), invalidate() {} },
            key,
            state,
            redraw,
            theme,
          ),
        globalExpanded,
      ) ?? group.rows),
      footer(at, undefined, theme, 'user', group.input?.origin === 'composer' ? 'You' : 'Input'),
    )
  const key = `input:${group.input.id}`
  const open = state.open.has(key)
  const preview = textOf(group.message.content).trim().split('\n')[0].replace(/\s+/g, ' ')
  const label = line(`${open ? '▾' : '▸'} Extension input${preview ? ` · ${preview}` : ''}`, theme)
  const skill = group.rows.find((row) => row instanceof SkillInvocationMessageComponent)
  const header = skill
    ? disclosureHeader(label, key, skill as unknown as NativeDisclosureRow, state, redraw, theme)
    : clickable(label, key, state, redraw, theme)
  if (!open) return header
  return stack(
    header,
    ...group.rows.map((row) =>
      row instanceof SkillInvocationMessageComponent
        ? disclosureBody(row as unknown as NativeDisclosureRow, key, state, redraw)
        : row,
    ),
  )
}

function assistantVisibility(child: Component): 'soft' | 'hard' | 'none' {
  if (!(child instanceof AssistantMessageComponent)) return 'none'
  const message = record((child as unknown as { lastMessage?: unknown }).lastMessage)
  if (!Array.isArray(message.content)) return 'hard'
  const hasText = textOf(message.content).trim().length > 0
  const hasThinking = message.content.some((block) => {
    const value = record(block)
    return value.type === 'thinking' && typeof value.thinking === 'string' && value.thinking.trim()
  })
  const hasToolCall = message.content.some((block) => record(block).type === 'toolCall')
  const hasStopNotice = ['error', 'aborted', 'length'].includes(String(message.stopReason))
  if (!hasText && !hasStopNotice && (hasThinking || hasToolCall)) return 'soft'
  return 'hard'
}

/** A display copy: source children, messages, and native components retain their identity. */
export function projectTranscript(
  children: Component[],
  state: LensState,
  theme: Theme,
  redraw: () => void,
  toolsExpanded = false,
): Component[] {
  const hover = hoverFor(state)
  hover.beginFrame()
  const bypass = state.view === 'raw' || toolsExpanded
  const groups = new Map<string, ToolRow[]>()
  const groupFor = new Map<Component, string>()
  const disclosures: DisclosureEntry[] = []
  const inputs = inputGroups(children)
  const voices = voiceGroups(children)
  const nativeImageFallbacks = new Set<Component>()
  // Hard boundaries preserve user-visible order; thinking-only assistant rows are soft span members.
  let boundary = 0
  for (const child of children) {
    if (child instanceof ToolExecutionComponent) {
      const row = child as unknown as ToolRow
      if (typeof row.toolCallId !== 'string' || typeof row.toolName !== 'string')
        throw new Error('Unsupported Pi tool row')
      const kind = stepKind(row.toolName)
      const stamp = state.calls.get(row.toolCallId)
      if (!bypass) {
        const imageRead = hasNativeImageReadContent(row)
        const imageSupported =
          isNativeImageReadResult(row) && nativeImageReadParts(row) !== undefined
        if (imageRead && !imageSupported) {
          nativeImageFallbacks.add(child)
          boundary++
          continue
        }
      }
      disclosures.push({
        row,
        key: `step:${row.toolCallId}`,
        managed: kind !== 'question' || questionData(row) !== undefined,
      })
      if (!stamp || kind === 'question') {
        boundary++
        continue
      }
      const key = `${boundary}:${stamp.turn}:${stamp.run}`
      const group = groups.get(key) ?? []
      group.push(row)
      groups.set(key, group)
      groupFor.set(child, key)
    } else if (child instanceof AssistantMessageComponent) {
      const message = record((child as unknown as { lastMessage?: unknown }).lastMessage)
      if (assistantVisibility(child) === 'hard') boundary++
    } else if (
      child instanceof UserMessageComponent ||
      child instanceof SkillInvocationMessageComponent ||
      child instanceof CustomMessageComponent
    ) {
      const input = inputs.get(child)?.input
      if (child instanceof SkillInvocationMessageComponent && input?.origin === 'extension')
        disclosures.push({
          row: child as unknown as NativeDisclosureRow,
          key: `input:${input.id}`,
          managed: true,
        })
      const voice = voices.get(child)
      if (voice)
        disclosures.push({ row: child as NativeDisclosureRow, key: voice.key, managed: true })
      boundary++
    }
  }
  reconcileDisclosures(state, disclosures, state.view === 'raw', toolsExpanded)
  if (bypass) {
    if (state.view === 'raw') invalidateClipboardProjection(children, state)
    // Native global expansion cannot reveal sidecar bytes; keep its original rows except clipboard groups.
    const drawnInputs = new Set<InputGroup>()
    const result =
      state.view === 'raw' || ![...inputs.values()].some((group) => group.clipboard)
        ? children
        : children.flatMap((child) => {
            const input = inputs.get(child)
            if (!input?.clipboard) return [child]
            if (drawnInputs.has(input)) return []
            drawnInputs.add(input)
            return [inputRow(input, state, theme, redraw, true)]
          })
    hover.endFrame()
    return result
  }
  const progress = projectProgress(
    children,
    state,
    theme,
    (key, text, activate) => hoverHeader(wrappedLine(text, theme), key, activate, theme, hover),
    redraw,
    () => hover.clear(),
  )

  const drawnInputs = new Set<InputGroup>()
  const drawn = new Set<string>()
  const drawnVoices = new Set<VoiceGroup>()
  const result: Component[] = []

  const renderChild = (child: Component, index: number): Component[] => {
    if (
      isMessageSpacer(child) &&
      isMessageShell(children[index + 1]) &&
      (index === 0 || isMessageShell(children[index - 1]))
    )
      return []
    const key = groupFor.get(child)
    if (key) {
      if (drawn.has(key)) return []
      drawn.add(key)
      return [foldRows(groups.get(key)!, state, theme, redraw)]
    }
    if (child instanceof ToolExecutionComponent) {
      if (nativeImageFallbacks.has(child)) return [child]
      return [toolFallback(child as unknown as ToolRow, state, theme, redraw)]
    }
    if (child instanceof CustomMessageComponent) {
      const voice = voices.get(child)
      if (voice) {
        if (drawnVoices.has(voice)) return []
        drawnVoices.add(voice)
        return [voiceGroupRow(voice, state, theme, redraw)]
      }
      return [compactMessageShell(child)]
    }
    const input = inputs.get(child)
    if (input) {
      if (drawnInputs.has(input)) return []
      drawnInputs.add(input)
      return [inputRow(input, state, theme, redraw)]
    }
    if (child instanceof UserMessageComponent || child instanceof SkillInvocationMessageComponent)
      return [stack(child, footer(undefined, undefined, theme, 'user'))]
    if (child instanceof AssistantMessageComponent) {
      const message = record((child as unknown as { lastMessage?: unknown }).lastMessage)
      if (
        typeof message.timestamp === 'number' &&
        state.assistants.has(message.timestamp) &&
        textOf(message.content).trim()
      ) {
        const model =
          typeof message.responseModel === 'string'
            ? message.responseModel
            : typeof message.model === 'string'
              ? message.model
              : undefined
        return [
          stack(
            compactMessageShell(child, progress.get(child) ?? child),
            footer(message.timestamp, model, theme, 'reply'),
          ),
        ]
      }
    }
    return [compactMessageShell(child, progress.get(child) ?? child)]
  }

  const isSoftSpanChild = (child: Component, index: number): boolean => {
    if (groupFor.has(child)) return true
    if (assistantVisibility(child) === 'soft' && progress.has(child)) return true
    return (
      isMessageSpacer(child) &&
      index > 0 &&
      index + 1 < children.length &&
      isSoftSpanChild(children[index - 1]!, index - 1) &&
      (groupFor.has(children[index + 1]!) ||
        (assistantVisibility(children[index + 1]!) === 'soft' &&
          progress.has(children[index + 1]!)))
    )
  }

  const renderSoftSpan = (span: Component[]): Component[] => {
    const rendered: Component[] = []
    const toolRows = span.filter((child): child is ToolRow => groupFor.has(child)) as ToolRow[]
    if (toolRows.length) {
      const firstKey = groupFor.get(toolRows[0] as unknown as Component)
      const sameGroup = firstKey && toolRows.every((row) => groupFor.get(row) === firstKey)
      if (sameGroup && firstKey && !drawn.has(firstKey)) {
        drawn.add(firstKey)
        rendered.push(foldRows(groups.get(firstKey)!, state, theme, redraw))
      } else {
        for (const row of toolRows) {
          const key = groupFor.get(row)
          if (!key || drawn.has(key)) continue
          drawn.add(key)
          rendered.push(foldRows(groups.get(key)!, state, theme, redraw))
        }
      }
    }
    for (const child of span) {
      if (!(child instanceof AssistantMessageComponent)) continue
      const projected = progress.get(child)
      if (projected) rendered.push(compactMessageShell(child, projected))
    }
    return rendered
  }

  for (let index = 0; index < children.length;) {
    if (!isSoftSpanChild(children[index]!, index)) {
      result.push(...renderChild(children[index]!, index))
      index++
      continue
    }
    const span: Component[] = []
    while (index < children.length && isSoftSpanChild(children[index]!, index)) {
      span.push(children[index]!)
      index++
    }
    result.push(...renderSoftSpan(span))
  }
  const running = children
    .filter((child): child is ToolExecutionComponent => child instanceof ToolExecutionComponent)
    .map((row) => normalized(row as unknown as ToolRow, state))
    .filter((step) => step.status === 'running')
  const activity = [
    progress.activity,
    running.length ? `Running… · ${running.map((step) => step.label).join(' · ')}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
  if (activity) result.push(line(activity, theme))
  hover.endFrame()
  return result
}
