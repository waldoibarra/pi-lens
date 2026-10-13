import { parseSkillBlock } from '@earendil-works/pi-coding-agent'
import { Marked } from '@earendil-works/pi-tui'
import type { LensView } from './domain'
import { clipboardDisplay, inputIdentity, type InputBinding } from './adapter'
import { clipboardKey } from './clipboard'

export type RecordValue = Record<string, unknown>
export const record = (value: unknown): RecordValue =>
  value !== null && typeof value === 'object' ? (value as RecordValue) : {}
export function textOf(content: unknown, separator = '\n'): string {
  if (typeof content === 'string') return content
  return Array.isArray(content)
    ? content
        .filter((block) => record(block).type === 'text')
        .map((block) => (typeof block.text === 'string' ? block.text : ''))
        .join(separator)
    : ''
}
export interface Stamp {
  at: number
  model?: string
}
export interface CallStamp extends Stamp {
  turn: string
  run: number
}
export interface UserStamp extends Stamp {
  text: string
}

const progressMarkdownParser = new Marked()

function safeProgressText(text: string): string {
  return text
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function progressHeadingFromLine(line: string): string | undefined {
  const value = line.trim()
  if (!value) return undefined
  const atx = value.match(/^#{1,6}\s+(.+?)\s*#*\s*$/)
  if (atx?.[1]?.trim()) return safeProgressText(atx[1])
  const bold = value.match(/^\*\*(.+?)\*\*$/) ?? value.match(/^__(.+?)__$/)
  if (bold?.[1]?.trim()) return safeProgressText(bold[1])
  return undefined
}

function progressUpdateCount(text: string): number {
  const tokens = progressMarkdownParser.lexer(text)
  if (Object.keys(tokens.links).length > 0) return 0
  let count = 0
  let current = ''
  const flush = () => {
    if (current.trim()) count++
    current = ''
  }
  const append = (raw: string, heading?: string) => {
    if (heading) flush()
    current += raw
  }
  for (const token of tokens) {
    if (token.type === 'heading') {
      append(token.raw, safeProgressText(token.text))
    } else if (
      token.type === 'paragraph' &&
      !(token.tokens ?? []).some((part) => part.type === 'codespan' && part.raw.includes('\n'))
    ) {
      for (const line of token.raw.match(/[^\n]*(?:\n|$)/g) ?? []) {
        if (!line) continue
        append(line, /^(?: {4}|\t)/.test(line) ? undefined : progressHeadingFromLine(line))
      }
    } else {
      append(token.raw)
    }
  }
  flush()
  return count
}

function progressKeys(message: RecordValue): { parents: string[]; details: string[] } {
  if (typeof message.timestamp !== 'number' || !Array.isArray(message.content))
    return { parents: [], details: [] }
  const parents: string[] = []
  const details: string[] = []
  let runIndex = 0
  for (let i = 0; i < message.content.length; i++) {
    const block = record(message.content[i])
    if (block.type !== 'thinking') continue
    const parts: string[] = []
    for (; i < message.content.length; i++) {
      const thinking = record(message.content[i])
      if (thinking.type !== 'thinking') break
      const text = typeof thinking.thinking === 'string' ? thinking.thinking.trim() : ''
      if (text) parts.push(text)
    }
    i--
    if (parts.length) {
      parents.push(`progress:${message.timestamp}:${runIndex}`)
      const count = progressUpdateCount(parts.join('\n\n'))
      for (let index = 0; index < count; index++)
        details.push(`progress-detail:${message.timestamp}:${runIndex}:${index}`)
    }
    runIndex++
  }
  return { parents, details }
}

function isSerializedTimestamp(value: string): boolean {
  const timestamp = Number(value)
  return Number.isFinite(timestamp) && String(timestamp) === value
}

function decodeVoiceId(source: string): string {
  try {
    return decodeURIComponent(source)
  } catch {
    return source
  }
}

function voiceSourceExists(source: string, voiceIds: ReadonlySet<string>): boolean {
  const separator = source.lastIndexOf('@')
  const encodedId =
    separator > 0 && isSerializedTimestamp(source.slice(separator + 1))
      ? source.slice(0, separator)
      : source
  return voiceIds.has(decodeVoiceId(encodedId))
}

/** Only presentation choices and observed metadata survive a hot reload. */
export class LensState {
  view: LensView = 'normal'
  open = new Set<string>()
  clipboardImageIds = new Map<string, number>()
  calls = new Map<string, CallStamp>()
  users: UserStamp[] = []
  assistants = new Set<number>()
  private prose = new Set<number>()
  private turn = 'initial'
  private run = 0

  observe(raw: unknown): void {
    const message = record(raw)
    if (typeof message.timestamp !== 'number') return
    const at = message.timestamp
    if (message.role === 'user') {
      if (this.users.some((stamp) => stamp.at === at)) return
      const text = textOf(message.content, '')
      const skill = parseSkillBlock(text)
      const displayed = skill ? skill.userMessage : text
      if (displayed) this.users.push({ at, text: displayed })
      this.users = this.users.slice(-400)
      this.turn = String(at)
      this.run = 0
      return
    }
    if (message.role !== 'assistant' || !Array.isArray(message.content)) return
    this.assistants.add(at)
    if (textOf(message.content).trim() && !this.prose.has(at)) {
      this.prose.add(at)
      this.run++
    }
    const model =
      typeof message.responseModel === 'string'
        ? message.responseModel
        : typeof message.model === 'string'
          ? message.model
          : undefined
    for (const block of message.content) {
      const call = record(block)
      if (call.type !== 'toolCall' || typeof call.id !== 'string') continue
      const existing = this.calls.get(call.id)
      if (existing) {
        existing.model = model
        continue
      }
      this.calls.set(call.id, { at, model, turn: this.turn, run: this.run })
    }
    while (this.calls.size > 600) {
      const id = this.calls.keys().next().value!
      this.calls.delete(id)
    }
    while (this.assistants.size > 400) {
      const oldest = this.assistants.values().next().value!
      this.assistants.delete(oldest)
      this.prose.delete(oldest)
    }
  }

  reconcile(entries: readonly unknown[]): void {
    const times = new Set<number>()
    const ids = new Set<string>()
    const voiceIds = new Set<string>()
    const inputIds = new Set<string>()
    const clipboardKeys = new Set<string>()
    const progressIds = new Set<string>()
    const progressDetailIds = new Set<string>()
    const addVoice = (value: unknown) => {
      const message = record(value)
      if (message.customType !== 'pi-live-codex-delegation') return
      const details = record(message.details)
      if (typeof details.delegationId === 'string') voiceIds.add(details.delegationId)
    }
    for (const entry of entries) {
      const rawEntry = record(entry)
      const input = inputIdentity(rawEntry.inputDisplay)
      if (rawEntry.type === 'message' && record(rawEntry.message).role === 'user' && input) {
        const clipboard = clipboardDisplay(
          rawEntry.inputDisplay,
          rawEntry.message as InputBinding['message'],
        )
        for (const image of clipboard?.images ?? []) {
          clipboardKeys.add(clipboardKey(input.id, image.id))
          clipboardKeys.add(clipboardKey(input.id, image.id, true))
        }
      }
      if (
        rawEntry.type === 'message' &&
        record(rawEntry.message).role === 'user' &&
        input?.origin === 'extension'
      )
        inputIds.add(input.id)
      if (rawEntry.type === 'custom_message') addVoice(rawEntry)
      const message = record(rawEntry.message ?? entry)
      if (typeof message.timestamp === 'number') times.add(message.timestamp)
      const progress = progressKeys(message)
      for (const key of progress.parents) progressIds.add(key)
      for (const key of progress.details) progressDetailIds.add(key)
      if (message.role === 'custom') addVoice(message)
      if (Array.isArray(message.content))
        for (const block of message.content) {
          const call = record(block)
          if (call.type === 'toolCall' && typeof call.id === 'string') ids.add(call.id)
          if (call.type === 'custom_message') addVoice(call)
        }
    }
    this.users = this.users.filter((stamp) => times.has(stamp.at))
    this.assistants = new Set([...this.assistants].filter((at) => times.has(at)))
    this.prose = new Set([...this.prose].filter((at) => times.has(at)))
    for (const id of this.calls.keys()) if (!ids.has(id)) this.calls.delete(id)
    for (const key of this.clipboardImageIds.keys())
      if (!clipboardKeys.has(key)) this.clipboardImageIds.delete(key)
    for (const key of [...this.open]) {
      const separator = key.indexOf(':')
      if (separator < 0) continue
      const type = key.slice(0, separator)
      const id = key.slice(separator + 1)
      if ((type === 'step' || type === 'run') && !ids.has(id)) this.open.delete(key)
      if (type === 'image-details' && !ids.has(id)) this.open.delete(key)
      if ((type === 'clipboard' || type === 'clipboard-details') && !clipboardKeys.has(key))
        this.open.delete(key)
      if (type === 'voice' && !id.split('|').every((source) => voiceSourceExists(source, voiceIds)))
        this.open.delete(key)
      if (type === 'input' && !inputIds.has(id)) this.open.delete(key)
      if (type === 'progress' && !progressIds.has(key)) this.open.delete(key)
      if (type === 'progress-detail' && !progressDetailIds.has(key)) this.open.delete(key)
    }
    this.turn = String(this.users.at(-1)?.at ?? 'initial')
    this.run++
  }

  toggle(key: string): void {
    if (this.open.has(key)) this.open.delete(key)
    else this.open.add(key)
  }
}
