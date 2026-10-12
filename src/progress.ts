import { stripVTControlCharacters } from 'node:util'
import {
  AssistantMessageComponent,
  CustomMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
  type Theme,
} from '@earendil-works/pi-coding-agent'
import {
  Container,
  MouseRegion,
  Marked,
  wrapTextWithAnsi,
  type Component,
} from '@earendil-works/pi-tui'
import { LensState, record } from './state'
import { isMessageSpacer, emptyRow as empty } from './spacing'

export type ProgressHeader = (key: string, text: string, activate: () => void) => Component

type AssistantInternals = {
  contentContainer?: Container
  hideThinkingBlock?: boolean
  markdownTheme?: unknown
  hiddenThinkingLabel?: string
  outputPad?: number
  markdownTransformers?: readonly unknown[]
  lastMessage?: unknown
  isStreaming?: boolean
  updateContent(message: never, isStreaming?: boolean): void
  render(width: number): string[]
  invalidate?: () => void
  handleMouse?: Component['handleMouse']
}

type ThinkingUpdate = {
  text: string
  title: string
  body: string
}

type ThinkingRun = {
  text: string
  updates: ThinkingUpdate[]
  fallbackWholeRun: boolean
}

type PositionedThinkingRun = ThinkingRun & {
  runIndex: number
  thinkingIndex: number
  localBoundary: number
}

type SupportedAssistant = {
  component: AssistantMessageComponent
  internals: AssistantInternals
  message: Record<string, unknown>
  timestamp: number
  contentChildren: Component[]
  thinkingIndices: number[]
  runs: PositionedThinkingRun[]
  streaming: boolean
  changed: boolean
}

type ThinkingSegment = {
  row: SupportedAssistant
  run: PositionedThinkingRun
}

type ProgressGroup = {
  segments: ThinkingSegment[]
  key: string
  anchor: ThinkingSegment
  anchorIndex: number
  title: string
  updateCount: number
}

type MaterializedThinking = {
  message: unknown
  contentChildren: Component[]
  markdownTheme: unknown
  hiddenThinkingLabel: string | undefined
  outputPad: number | undefined
  markdownTransformers: readonly unknown[] | undefined
  streaming: boolean
  children: Component[]
}

type RelevantContent = 'thinking' | 'reply' | 'tool'

const materialized = new WeakMap<AssistantMessageComponent, MaterializedThinking>()

function stack(children: Component[]): Component {
  const container = new Container()
  container.children = children
  return container
}

class CompactThinkingUpdate implements Component {
  constructor(
    private readonly title: string,
    private readonly body: Component | undefined,
  ) {}

  render(width: number): string[] {
    const title = width <= 0 ? [''] : wrapTextWithAnsi(this.title, width)
    return [...title, ...(this.body?.render(width) ?? [])]
  }

  invalidate(): void {
    this.body?.invalidate?.()
  }

  handleMouse(event: Parameters<NonNullable<Component['handleMouse']>>[0]) {
    const titleHeight = event.width <= 0 ? 1 : wrapTextWithAnsi(this.title, event.width).length
    if (event.y < titleHeight) return undefined
    return this.body?.handleMouse?.({
      ...event,
      y: event.y - titleHeight,
      height: Math.max(0, event.height - titleHeight),
    })
  }
}

class BulletThinking implements Component {
  constructor(private readonly child: Component) {}

  render(width: number): string[] {
    if (width <= 2) return this.child.render(width)
    const lines = this.child.render(Math.max(0, width - 2))
    return lines.map((line, index) => `${index === 0 ? '• ' : '  '}${line}`)
  }

  invalidate(): void {
    this.child.invalidate?.()
  }

  handleMouse(event: Parameters<NonNullable<Component['handleMouse']>>[0]) {
    if (event.width <= 2) return this.child.handleMouse?.(event)
    if (event.x < 2) return undefined
    return this.child.handleMouse?.({ ...event, x: event.x - 2, width: event.width - 2 })
  }
}

function safeText(text: string): string {
  return stripVTControlCharacters(text)
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function progressLine(open: boolean, group: ProgressGroup): string {
  const count = group.updateCount > 1 ? ` · ${group.updateCount} updates` : ''
  return `${open ? '▾' : '▸'} Thinking updates · ${group.title}${count}`
}

function headingFromLine(line: string): string | undefined {
  const value = line.trim()
  if (!value) return undefined
  const atx = value.match(/^#{1,6}\s+(.+?)\s*#*\s*$/)
  if (atx?.[1]?.trim()) return safeText(atx[1])
  const bold = value.match(/^\*\*(.+?)\*\*$/) ?? value.match(/^__(.+?)__$/)
  if (bold?.[1]?.trim()) return safeText(bold[1])
  return undefined
}

const markdownParser = new Marked()

function firstNonemptyLine(text: string): string {
  return safeText(text.split(/\r?\n/).find((line) => line.trim()) ?? '')
}

function bodyWithoutTitle(text: string, title: string): string {
  const lines = text.split(/\r?\n/)
  const first = lines.findIndex((line) => line.trim())
  if (first < 0) return ''
  const line = lines[first] ?? ''
  const lineTitle = headingFromLine(line) ?? safeText(line)
  if (lineTitle !== title) return text
  const before = lines.slice(0, first)
  const after = lines.slice(first + 1)
  return [...before, ...after]
    .join('\n')
    .replace(/^\s*\n/, '')
    .trimEnd()
}

/** Token boundaries keep nested lists, quotes, and fenced code out of progress headings. */
function segmentThinkingRun(text: string): { updates: ThinkingUpdate[]; references: boolean } {
  const tokens = markdownParser.lexer(text)
  const updates: ThinkingUpdate[] = []
  let current = ''
  let title: string | undefined
  const flush = () => {
    const value = current.trim()
    if (value) {
      const updateTitle = title ?? firstNonemptyLine(value)
      updates.push({
        text: value,
        title: updateTitle,
        body: title ? bodyWithoutTitle(value, updateTitle) : value,
      })
    }
    current = ''
    title = undefined
  }
  const append = (raw: string, heading?: string) => {
    if (heading) {
      flush()
      title = heading
    }
    current += raw
  }
  for (const token of tokens) {
    if (token.type === 'heading') {
      append(token.raw, safeText(token.text))
    } else if (
      token.type === 'paragraph' &&
      !(token.tokens ?? []).some((part) => part.type === 'codespan' && part.raw.includes('\n'))
    ) {
      for (const line of token.raw.match(/[^\n]*(?:\n|$)/g) ?? []) {
        if (!line) continue
        append(line, /^(?: {4}|\t)/.test(line) ? undefined : headingFromLine(line))
      }
    } else {
      append(token.raw)
    }
  }
  flush()
  return { updates, references: Object.keys(tokens.links).length > 0 }
}

function parseThinkingRun(parts: string[]): ThinkingRun | undefined {
  if (!parts.length) return undefined
  const text = parts.join('\n\n')
  const { updates, references } = segmentThinkingRun(text)
  if (!updates.length) return undefined
  return { text, updates, fallbackWholeRun: references }
}

function collectAssistantContent(
  content: unknown[],
  thinkingIndices: number[] = [],
  streaming = false,
): {
  runs: PositionedThinkingRun[]
  boundarySpan: number
  activity: Map<number, { streaming: boolean; relevant: RelevantContent }>
} {
  const runs: PositionedThinkingRun[] = []
  const activity = new Map<number, { streaming: boolean; relevant: RelevantContent }>()
  let boundary = 0
  let runIndex = 0
  for (let i = 0; i < content.length; i++) {
    const block = record(content[i])
    if (block.type === 'thinking') {
      const parts: string[] = []
      for (; i < content.length; i++) {
        const thinking = record(content[i])
        if (thinking.type !== 'thinking') break
        const text = typeof thinking.thinking === 'string' ? thinking.thinking.trim() : ''
        if (text) parts.push(text)
      }
      i--
      const run = parseThinkingRun(parts)
      const thinkingIndex = thinkingIndices[runIndex]
      if (run) {
        activity.set(boundary, { streaming, relevant: 'thinking' })
        if (thinkingIndex !== undefined)
          runs.push({ ...run, runIndex, thinkingIndex, localBoundary: boundary })
      }
      runIndex++
    } else if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      activity.set(boundary, { streaming, relevant: 'reply' })
      boundary++
    } else if (block.type === 'toolCall') {
      activity.set(boundary, { streaming, relevant: 'tool' })
      boundary++
    }
  }
  return { runs, boundarySpan: boundary, activity }
}

function inspectAssistantActivity(component: Component):
  | {
      boundarySpan: number
      activity: Map<number, { streaming: boolean; relevant: RelevantContent }>
    }
  | undefined {
  if (!(component instanceof AssistantMessageComponent)) return undefined
  const internals = component as unknown as AssistantInternals
  const message = record(internals.lastMessage)
  if (!Array.isArray(message.content)) return undefined
  const collected = collectAssistantContent(message.content, [], internals.isStreaming === true)
  return { boundarySpan: collected.boundarySpan, activity: collected.activity }
}

function mouseRegionIndices(children: Component[]): number[] {
  const indices: number[] = []
  children.forEach((child, index) => {
    if (child instanceof MouseRegion) indices.push(index)
  })
  return indices
}

function nativeThinkingChildren(
  info: SupportedAssistant,
  message: unknown = info.internals.lastMessage,
  outputPad = info.internals.outputPad,
  expectedRuns = info.runs.length,
  transformers = info.internals.markdownTransformers,
): Component[] | undefined {
  try {
    const copy = new AssistantMessageComponent(
      message as never,
      false,
      info.internals.markdownTheme as never,
      info.internals.hiddenThinkingLabel,
      outputPad,
      transformers as never,
    ) as unknown as AssistantInternals
    if (message) copy.updateContent(message as never, info.streaming)
    const content = copy.contentContainer
    if (!content || !Array.isArray(content.children)) return undefined
    const indices = mouseRegionIndices(content.children)
    if (indices.length !== expectedRuns) return undefined
    return indices.map(
      (index) => (content.children[index] as unknown as { child: Component }).child,
    )
  } catch {
    return undefined
  }
}

function thinkingChildForText(info: SupportedAssistant, text: string): Component | undefined {
  const message = { ...info.message, content: [{ type: 'thinking', thinking: text }] }
  return nativeThinkingChildren(info, message, 0, 1, [])?.[0]
}

class NativeOrBulletedThinking implements Component {
  private body: Component

  constructor(
    private readonly native: Component,
    private readonly bullets: Component,
    private readonly capture: { text?: string },
    private readonly source: string,
    private readonly wholeRun: boolean,
  ) {
    this.body = native
  }

  render(width: number): string[] {
    // Native Markdown cache hits skip transformers; retain the last captured result across those renders.
    const original = this.native.render(width)
    // Native transformers run once on the complete document, with native width/context and error isolation.
    this.body = this.wholeRun || this.capture.text !== this.source ? this.native : this.bullets
    return this.body === this.native ? original : this.body.render(width)
  }

  invalidate(): void {
    this.native.invalidate()
    this.bullets.invalidate()
  }
  handleMouse(event: Parameters<NonNullable<Component['handleMouse']>>[0]) {
    return this.body.handleMouse?.(event)
  }
}

function segmentedThinkingChildren(info: SupportedAssistant): Component[] | undefined {
  const children: Component[] = []
  for (const run of info.runs) {
    const capture: { text?: string } = {}
    const captureText = (text: string) => {
      capture.text = text
      return text
    }
    const message = { ...info.message, content: [{ type: 'thinking', thinking: run.text }] }
    const native = nativeThinkingChildren(info, message, info.internals.outputPad, 1, [
      ...(info.internals.markdownTransformers ?? []),
      captureText,
    ])?.[0]
    if (!native) return undefined
    const bullets: Component[] = []
    if (!run.fallbackWholeRun)
      for (const update of run.updates) {
        const body = update.body ? thinkingChildForText(info, update.body) : undefined
        if (update.body && !body) return undefined
        bullets.push(new BulletThinking(new CompactThinkingUpdate(update.title, body)))
      }
    children.push(
      new NativeOrBulletedThinking(native, stack(bullets), capture, run.text, run.fallbackWholeRun),
    )
  }
  return children
}

function expandedThinkingChildren(info: SupportedAssistant): Component[] | undefined {
  const cached = materialized.get(info.component)
  if (
    cached &&
    cached.message === info.internals.lastMessage &&
    cached.contentChildren === info.contentChildren &&
    cached.markdownTheme === info.internals.markdownTheme &&
    cached.hiddenThinkingLabel === info.internals.hiddenThinkingLabel &&
    cached.outputPad === info.internals.outputPad &&
    cached.markdownTransformers === info.internals.markdownTransformers &&
    cached.streaming === info.streaming
  )
    return cached.children

  const children = segmentedThinkingChildren(info)
  if (!children) return undefined
  materialized.set(info.component, {
    message: info.internals.lastMessage,
    contentChildren: info.contentChildren,
    markdownTheme: info.internals.markdownTheme,
    hiddenThinkingLabel: info.internals.hiddenThinkingLabel,
    outputPad: info.internals.outputPad,
    markdownTransformers: info.internals.markdownTransformers,
    streaming: info.streaming,
    children,
  })
  return children
}

function inspectAssistant(component: Component): SupportedAssistant | undefined {
  if (!(component instanceof AssistantMessageComponent)) return undefined
  const internals = component as unknown as AssistantInternals
  const message = record(internals.lastMessage)
  if (typeof message.timestamp !== 'number' || !Array.isArray(message.content)) return undefined
  const contentContainer = internals.contentContainer
  if (!contentContainer || !Array.isArray(contentContainer.children)) return undefined
  const thinkingIndices = mouseRegionIndices(contentContainer.children)
  const collected = collectAssistantContent(
    message.content,
    thinkingIndices,
    internals.isStreaming === true,
  )
  if (!collected.runs.length || thinkingIndices.length !== collected.runs.length) return undefined
  const info: SupportedAssistant = {
    component,
    internals,
    message,
    timestamp: message.timestamp,
    contentChildren: contentContainer.children,
    thinkingIndices,
    runs: collected.runs,
    streaming: internals.isStreaming === true,
    changed: materialized.get(component)?.contentChildren !== contentContainer.children,
  }
  if (!expandedThinkingChildren(info)) return undefined
  return info
}

function isBoundary(child: Component): boolean {
  if (child instanceof UserMessageComponent) return true
  if (!(child instanceof CustomMessageComponent)) return false
  const message = record((child as unknown as { message?: unknown }).message)
  return message.customType === 'pi-live-codex-delegation'
}

function buildGroup(segments: ThinkingSegment[]): ProgressGroup | undefined {
  const anchor = segments[0]
  if (!anchor) return undefined
  let title = ''
  let updateCount = 0
  for (const segment of segments) {
    for (const update of segment.run.updates) {
      updateCount++
      title = update.title || title
    }
  }
  if (!title || updateCount === 0) return undefined
  return {
    segments,
    key: `progress:${anchor.row.timestamp}:${anchor.run.runIndex}`,
    anchor,
    anchorIndex: anchor.run.thinkingIndex,
    title,
    updateCount,
  }
}

function fullHistory(group: ProgressGroup): Component[] {
  const children: Component[] = []
  for (const segment of group.segments) {
    const expanded = expandedThinkingChildren(segment.row)
    const child = expanded?.[segment.run.runIndex]
    if (child) children.push(child)
  }
  return children
}

class ProgressAssistantDisplay implements Component {
  private readonly headerComponents = new Map<string, Component>()

  constructor(
    private readonly info: SupportedAssistant,
    private readonly groups: ProgressGroup[],
    private readonly state: LensState,
    header: ProgressHeader,
    redraw: () => void,
  ) {
    for (const group of groups) {
      if (group.anchor.row !== info) continue
      this.headerComponents.set(
        group.key,
        header(group.key, safeText(progressLine(state.open.has(group.key), group)), () => {
          state.toggle(group.key)
          redraw()
        }),
      )
    }
  }

  render(width: number): string[] {
    const content = this.info.internals.contentContainer
    if (!content) return this.info.component.render(width)
    const originalChildren = content.children
    const projected = originalChildren.slice()
    if (isMessageSpacer(projected[0])) projected[0] = empty
    for (const run of this.info.runs) {
      projected[run.thinkingIndex] = empty
      for (const index of [run.thinkingIndex - 1, run.thinkingIndex + 1]) {
        if (isMessageSpacer(originalChildren[index])) projected[index] = empty
      }
    }
    for (const group of this.groups) {
      if (group.anchor.row !== this.info) continue
      const header = this.headerComponents.get(group.key)!
      projected[group.anchorIndex] = this.state.open.has(group.key)
        ? stack([header, ...fullHistory(group)])
        : header
    }
    content.children = projected
    try {
      return this.info.component.render(width)
    } finally {
      content.children = originalChildren
    }
  }

  invalidate(): void {
    materialized.delete(this.info.component)
    this.info.component.invalidate?.()
  }

  handleMouse(event: Parameters<NonNullable<Component['handleMouse']>>[0]) {
    return this.info.component.handleMouse?.(event)
  }
}

export function projectProgress(
  children: Component[],
  state: LensState,
  _theme: Theme,
  header: ProgressHeader,
  redraw: () => void,
  layoutChanged: () => void = () => {},
): Map<Component, Component> & { activity?: string } {
  const byBoundary = new Map<number, ThinkingSegment[]>()
  const rowGroups = new Map<SupportedAssistant, ProgressGroup[]>()
  const boundaryActivity = new Map<number, { streaming: boolean; relevant: RelevantContent }>()
  let boundary = 0
  let latestActivityBoundary: number | undefined
  for (const child of children) {
    if (isBoundary(child)) {
      latestActivityBoundary = undefined
      boundary++
      continue
    }
    if (child instanceof ToolExecutionComponent) {
      boundaryActivity.set(boundary, { streaming: false, relevant: 'tool' })
      latestActivityBoundary = boundary
      boundary++
      continue
    }

    const activity = inspectAssistantActivity(child)
    if (activity) {
      for (const [local, value] of activity.activity) {
        boundaryActivity.set(boundary + local, value)
        latestActivityBoundary = boundary + local
      }
    }

    const info = inspectAssistant(child)
    if (info) {
      for (const run of info.runs) {
        const key = boundary + run.localBoundary
        const segments = byBoundary.get(key) ?? []
        segments.push({ row: info, run })
        byBoundary.set(key, segments)
      }
    }
    if (activity) boundary += activity.boundarySpan
  }

  const groups = new Map<number, ProgressGroup>()
  for (const [key, segments] of byBoundary) {
    const group = buildGroup(segments)
    if (!group) continue
    groups.set(key, group)
    for (const segment of segments) {
      const row = segment.row
      const rowItems = rowGroups.get(row) ?? []
      if (!rowItems.includes(group)) rowItems.push(group)
      rowGroups.set(row, rowItems)
    }
    if (state.open.has(group.key) && segments.some((segment) => segment.row.changed))
      layoutChanged()
  }

  const replacements: Map<Component, Component> & { activity?: string } = new Map()
  if (latestActivityBoundary !== undefined) {
    const activity = boundaryActivity.get(latestActivityBoundary)
    const group = groups.get(latestActivityBoundary)
    if (group && activity?.streaming && activity.relevant === 'thinking')
      replacements.activity = safeText(`Thinking… · ${group.title}`)
  }
  for (const [row, groupsForRow] of rowGroups)
    replacements.set(
      row.component,
      new ProgressAssistantDisplay(row, groupsForRow, state, header, redraw),
    )
  return replacements
}
