import { Container, type Component } from '@earendil-works/pi-tui'
import * as Pi from '@earendil-works/pi-coding-agent'
import {
  SkillInvocationMessageComponent,
  UserMessageComponent,
} from '@earendil-works/pi-coding-agent'

export type InputIdentity = {
  id: string
  origin: 'composer' | 'extension' | 'rpc' | 'unknown'
}

/** Structural compatibility with the patched host; Pi 1.1.0 exports no identity helpers. */
export function inputIdentity(value: unknown): InputIdentity | undefined {
  if (!value || typeof value !== 'object') return undefined
  const display = value as { version?: unknown; input?: unknown }
  if (display.version !== 1 || !display.input || typeof display.input !== 'object') return undefined
  const input = display.input as { id?: unknown; origin?: unknown }
  if (typeof input.id !== 'string' || !input.id) return undefined
  if (
    input.origin !== 'composer' &&
    input.origin !== 'extension' &&
    input.origin !== 'rpc' &&
    input.origin !== 'unknown'
  )
    return undefined
  return { id: input.id, origin: input.origin }
}

export type ClipboardDisplay = {
  readonly version: 1
  readonly images: readonly {
    readonly id: string
    readonly number: number
    readonly originalPath: string
    readonly mimeType: string
    readonly data: string
  }[]
  readonly spans: readonly {
    readonly attachmentId: string
    readonly contentIndex: number
    readonly start: number
    readonly end: number
  }[]
}

type NormalizeInputDisplay = (
  value: unknown,
  message: InputBinding['message'],
) => { clipboard?: ClipboardDisplay } | undefined

// Namespace access avoids a missing named export on published and identity-only hosts.
const normalizeInputDisplay = (
  Pi as unknown as {
    normalizeUserMessageInputDisplay?: NormalizeInputDisplay
  }
).normalizeUserMessageInputDisplay

export function clipboardDisplay(
  value: unknown,
  message: InputBinding['message'],
  normalize: NormalizeInputDisplay | undefined = normalizeInputDisplay,
): ClipboardDisplay | undefined {
  if (inputIdentity(value)?.origin !== 'composer' || typeof normalize !== 'function') return
  return normalize(value, message)?.clipboard
}

export type InputBinding = {
  message: { role: 'user'; content: unknown; timestamp?: number }
  input?: InputIdentity
  clipboard?: ClipboardDisplay
  entryId?: string
}

/** Only native input components can establish a binding, never a matching text or timestamp. */
export function inputBinding(row: Component): InputBinding | undefined {
  if (!(row instanceof UserMessageComponent || row instanceof SkillInvocationMessageComponent))
    return undefined
  const raw = (row as unknown as { binding?: unknown }).binding
  if (!raw || typeof raw !== 'object') return undefined
  const binding = raw as {
    message?: unknown
    inputDisplay?: unknown
    entryId?: unknown
    part?: unknown
  }
  if (!binding.message || typeof binding.message !== 'object') return undefined
  const message = binding.message as InputBinding['message']
  if (message.role !== 'user') return undefined
  if (
    row instanceof SkillInvocationMessageComponent
      ? binding.part !== 'skill'
      : binding.part !== 'body' && binding.part !== 'skill-arguments'
  )
    return undefined
  if (binding.entryId !== undefined && typeof binding.entryId !== 'string') return undefined
  return {
    message,
    input: inputIdentity(binding.inputDisplay),
    clipboard: clipboardDisplay(binding.inputDisplay, message),
    entryId: binding.entryId,
  }
}

/** Pi 1.1 keeps header, resources, and chat in the first document container. */
export function findTranscript(tui: unknown): Container | undefined {
  const document = (tui as Container | undefined)?.children?.[0]
  if (!(document instanceof Container) || document.children.length !== 3) return undefined
  const chat = document.children[2]
  return chat instanceof Container ? chat : undefined
}

/** Own only this chat instance. Pi still walks its original children for native shortcuts. */
export function attachProjection(
  chat: Container,
  enabled: () => boolean,
  project: () => Component[],
  onFailure: (error: unknown) => void = () => {},
): () => void {
  const projection = new Container()
  let active = true
  let failed = false
  let projected = false
  let nativeBypass = false
  const render = chat.render
  const mouse = chat.handleMouse
  const invalidate = chat.invalidate
  const descriptors = new Map(
    ['render', 'handleMouse', 'invalidate'].map(
      (key) => [key, Object.getOwnPropertyDescriptor(chat, key)] as const,
    ),
  )
  const fail = (error: unknown) => {
    failed = true
    projected = false
    projection.clear()
    onFailure(error)
  }
  const canProject = () => active && !failed && enabled()
  const wrappedRender = function (width: number): string[] {
    projected = false
    nativeBypass = false
    if (!canProject()) return render.call(chat, width)
    let next: Component[]
    try {
      next = project()
    } catch (error) {
      fail(error)
      return render.call(chat, width)
    }
    if (next === chat.children) {
      projection.clear()
      nativeBypass = true
      return render.call(chat, width)
    }
    try {
      projection.children = next
      const lines = projection.render(width)
      projected = true
      return lines
    } catch (error) {
      fail(error)
      return render.call(chat, width)
    }
  }
  const wrappedMouse: Container['handleMouse'] = (event) => {
    if (canProject() && nativeBypass) return mouse.call(chat, event)
    if (canProject() && projected) {
      try {
        return projection.handleMouse(event)
      } catch (error) {
        fail(error)
      }
    }
    return mouse.call(chat, event)
  }
  const wrappedInvalidate = () => {
    invalidate.call(chat)
    if (canProject() && projected) {
      try {
        projection.invalidate()
      } catch (error) {
        fail(error)
      }
    }
  }
  chat.render = wrappedRender
  chat.handleMouse = wrappedMouse
  chat.invalidate = wrappedInvalidate
  return () => {
    active = false
    projection.clear()
    for (const [key, ours] of [
      ['render', wrappedRender],
      ['handleMouse', wrappedMouse],
      ['invalidate', wrappedInvalidate],
    ] as const) {
      if (chat[key] !== ours) continue
      const descriptor = descriptors.get(key)
      if (descriptor) Object.defineProperty(chat, key, descriptor)
      else Reflect.deleteProperty(chat, key)
    }
  }
}
