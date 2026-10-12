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
import {
  disclosureBody,
  hasNativeImageReadContent,
  isNativeImageReadResult,
  nativeImageDisclosureBody,
  nativeImageReadParts,
  reconcileDisclosures,
  setNativeExpanded,
  voiceId,
  type DisclosureEntry,
  type NativeDisclosureRow,
} from './disclosure'

type ToolRow = Component & ToolData & NativeDisclosureRow

const REPLY_DARK = rgbColor(217, 119, 87)
const REPLY_LIGHT = rgbColor(166, 71, 45)

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

function line(
  text: string,
  theme: Theme,
  tone: 'muted' | 'error' | 'accent' | 'reply' = 'muted',
  right = false,
): Component {
  return {
    render(width) {
      const safe = stripVTControlCharacters(text)
        .replace(/[\r\n\t]/g, ' ')
        .replace(/[\x00-\x1f\x7f]/g, '')
      const value = truncateToWidth(safe, Math.max(0, width))
      const padding = right ? ' '.repeat(Math.max(0, width - visibleWidth(value))) : ''
      const styled =
        tone === 'reply'
          ? theme.style(value, {
              fg: theme.appearance === 'light' ? REPLY_LIGHT : REPLY_DARK,
              bold: true,
            })
          : theme.fg(tone, value)
      return [padding + styled]
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
  role: 'user' | 'reply' | 'tools' = 'tools',
  inputLabel = 'Input',
): Component {
  const label = `${role === 'user' ? inputLabel : modelName(model)}${at === undefined ? '' : ` · ${formatTime(at, null)}`}`
  return line(label, theme, role === 'reply' ? 'reply' : 'muted', true)
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

function voiceRow(
  row: Component,
  state: LensState,
  theme: Theme,
  redraw: () => void,
): Component | undefined {
  const native = row as Component & { message?: unknown }
  const message = record(native.message)
  if (message.customType !== 'pi-live-codex-delegation') return undefined
  const data = record(message.details)
  if (typeof data.delegationId !== 'string') return undefined
  const key = `voice:${data.delegationId}`
  const open = state.open.has(key)
  const preview = textOf(message.content).trim().split('\n')[0].replace(/\s+/g, ' ')
  const attachments = Array.isArray(data.attachments) ? data.attachments.length : 0
  const title = `${open ? '▾' : '▸'} Voice request: ${preview || '(attachments)'}${attachments ? ` · ${attachments} attachments` : ''}`
  const disclosureRow = row as NativeDisclosureRow
  const header = disclosureHeader(line(title, theme), key, disclosureRow, state, redraw, theme)
  return open ? stack(header, disclosureBody(disclosureRow, key, state, redraw)) : header
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
      group.entryId !== binding.entryId
    ) {
      conflicted.add(group)
    }
    group.rows.push(row)
    byRow.set(row, group)
  }
  for (const group of conflicted) group.input = undefined
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
): Component {
  const at = typeof group.message.timestamp === 'number' ? group.message.timestamp : undefined
  if (group.input?.origin !== 'extension')
    return stack(
      ...group.rows,
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
  const nativeImageFallbacks = new Set<Component>()
  // Notices and user-visible prose remain at their original positions.
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
      if (!stamp || kind === 'question') continue
      const key = `${boundary}:${stamp.turn}:${stamp.run}`
      const group = groups.get(key) ?? []
      group.push(row)
      groups.set(key, group)
      groupFor.set(child, key)
    } else if (child instanceof AssistantMessageComponent) {
      const message = record((child as unknown as { lastMessage?: unknown }).lastMessage)
      if (
        textOf(message.content).trim() ||
        (Array.isArray(message.content) &&
          message.content.some((block) => {
            const value = record(block)
            return (
              value.type === 'thinking' &&
              typeof value.thinking === 'string' &&
              value.thinking.trim()
            )
          })) ||
        ['error', 'aborted', 'length'].includes(String(message.stopReason))
      )
        boundary++
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
      const id = voiceId(child)
      if (id)
        disclosures.push({ row: child as NativeDisclosureRow, key: `voice:${id}`, managed: true })
      boundary++
    }
  }
  reconcileDisclosures(state, disclosures, state.view === 'raw', toolsExpanded)
  if (bypass) {
    hover.endFrame()
    return children
  }
  const progress = projectProgress(
    children,
    state,
    theme,
    (key, text, activate) => hoverHeader(line(text, theme), key, activate, theme, hover),
    redraw,
    () => hover.clear(),
  )

  const drawnInputs = new Set<InputGroup>()
  const drawn = new Set<string>()
  const result = children.flatMap((child, index) => {
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
    if (child instanceof CustomMessageComponent)
      return [voiceRow(child, state, theme, redraw) ?? compactMessageShell(child)]
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
  })
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
