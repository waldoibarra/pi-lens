import { CustomMessageComponent, createReadToolDefinition } from '@earendil-works/pi-coding-agent'
import { Container, getCapabilities, type Component } from '@earendil-works/pi-tui'
import { LensState, record } from './state'

export type NativeDisclosureRow = Component & {
  setExpanded?: (expanded: boolean) => void
  expanded?: boolean
  _expanded?: boolean
}

type NativeReadImageRow = NativeDisclosureRow & {
  toolName?: unknown
  toolCallId?: unknown
  isPartial?: unknown
  result?: { content?: unknown; isError?: unknown }
  toolDefinition?: { renderCall?: unknown; renderResult?: unknown; renderShell?: unknown }
  children?: unknown[]
  contentBox?: Component
  imageComponents?: Component[]
  imageSources?: Array<{ data?: unknown; mimeType?: unknown; widthCells?: unknown }>
  imageSpacers?: Component[]
}

export type NativeImageReadParts = {
  contentBox: Component
  images: Component[]
  spacers: Component[]
}

const nativeReadDefinition = createReadToolDefinition('/')

export type DisclosureEntry = {
  row: NativeDisclosureRow
  key: string
  managed: boolean
}

type Controller = {
  previousGlobal: boolean
  previousBypass: boolean
  encountered: WeakSet<object>
}

const controllers = new WeakMap<LensState, Controller>()

const controllerFor = (state: LensState): Controller => {
  let controller = controllers.get(state)
  if (!controller) {
    controller = { previousGlobal: false, previousBypass: false, encountered: new WeakSet() }
    controllers.set(state, controller)
  }
  return controller
}

export function nativeExpanded(row: NativeDisclosureRow): boolean {
  if (typeof row.expanded === 'boolean') return row.expanded
  if (typeof row._expanded === 'boolean') return row._expanded
  return false
}

export function setNativeExpanded(row: NativeDisclosureRow, expanded: boolean): void {
  if (nativeExpanded(row) === expanded) return
  if (typeof row.setExpanded === 'function') row.setExpanded(expanded)
  else if (typeof row.expanded === 'boolean') row.expanded = expanded
  else if (typeof row._expanded === 'boolean') row._expanded = expanded
}

function clearIndividualOpens(state: LensState): void {
  for (const key of [...state.open]) {
    if (key.startsWith('step:') || key.startsWith('voice:') || key.startsWith('image-details:'))
      state.open.delete(key)
  }
}

function mirrorNative(entries: readonly DisclosureEntry[], state: LensState): void {
  for (const entry of entries) {
    if (nativeExpanded(entry.row)) state.open.add(entry.key)
    else state.open.delete(entry.key)
  }
}

export function reconcileDisclosures(
  state: LensState,
  entries: readonly DisclosureEntry[],
  raw: boolean,
  globalExpanded: boolean,
): void {
  const controller = controllerFor(state)
  for (const entry of entries) {
    if (
      !controller.encountered.has(entry.row) &&
      !globalExpanded &&
      entry.managed &&
      state.open.has(entry.key)
    ) {
      setNativeExpanded(entry.row, true)
    }
    controller.encountered.add(entry.row)
  }
  const bypass = raw || globalExpanded
  if (controller.previousGlobal && !globalExpanded) clearIndividualOpens(state)
  else if (raw || (controller.previousBypass && !bypass)) mirrorNative(entries, state)
  if (!bypass) {
    for (const entry of entries) {
      if (entry.managed) setNativeExpanded(entry.row, state.open.has(entry.key))
    }
  }
  controller.previousGlobal = globalExpanded
  controller.previousBypass = bypass
}

export function disclosureBody(
  row: NativeDisclosureRow,
  key: string,
  state: LensState,
  redraw: () => void,
): Component {
  return {
    render(width) {
      return row.render(width)
    },
    invalidate() {
      row.invalidate?.()
    },
    handleMouse(event) {
      const before = state.open.has(key)
      const result = row.handleMouse?.(event)
      const expanded = nativeExpanded(row)
      if (expanded) state.open.add(key)
      else state.open.delete(key)
      if (state.open.has(key) !== before) redraw()
      return result
    },
  }
}

function imageBlocks(row: NativeReadImageRow): Array<{ data: string; mimeType: string }> {
  const content = row.result?.content
  if (!Array.isArray(content)) return []
  return content.flatMap((block) => {
    const value = record(block)
    return value.type === 'image' &&
      typeof value.data === 'string' &&
      typeof value.mimeType === 'string'
      ? [{ data: value.data, mimeType: value.mimeType }]
      : []
  })
}

export function hasNativeImageReadContent(row: NativeDisclosureRow): boolean {
  const native = row as NativeReadImageRow
  return native.toolName === 'read' && imageBlocks(native).length > 0
}

export function isNativeImageReadResult(row: NativeDisclosureRow): boolean {
  const native = row as NativeReadImageRow
  return hasNativeImageReadContent(row) && !native.isPartial && !native.result?.isError
}

const probeCache = new WeakMap<Component, Map<number, boolean>>()

const clearProbeCache = (component: Component): void => {
  probeCache.delete(component)
}

const rendersImageProtocol = (component: Component, width: number): boolean => {
  const cached = probeCache.get(component)?.get(width)
  if (cached !== undefined) return cached
  let result = false
  try {
    result = component
      .render(width)
      .some((line) => line.includes('\x1b_G') || line.includes('\x1b]1337;File='))
  } catch {
    result = false
  }
  // Transcoder registration invalidates native images, not this disclosure's probe cache.
  // A failed probe must remain retryable after that native invalidation.
  if (result) {
    const byWidth = probeCache.get(component) ?? new Map<number, boolean>()
    byWidth.set(width, true)
    probeCache.set(component, byWidth)
  }
  return result
}

const hasRenderableImage = (
  component: Component,
  mimeType: unknown,
  width: number | undefined,
): boolean => {
  const capabilities = getCapabilities()
  if (!capabilities.images) return false
  if (capabilities.images !== 'kitty') return true
  if (mimeType === 'image/png') return true
  return width === undefined ? false : rendersImageProtocol(component, width)
}

const isHarmlessNativeSpacer = (component: unknown): boolean => {
  const value = component as { constructor?: { name?: string }; render?: unknown }
  return value.constructor?.name === 'Spacer' && typeof value.render === 'function'
}

export function nativeImageReadParts(
  row: NativeDisclosureRow,
  width?: number,
): NativeImageReadParts | undefined {
  const native = row as NativeReadImageRow
  if (!isNativeImageReadResult(row)) return undefined
  if (
    native.toolDefinition?.renderShell !== undefined &&
    native.toolDefinition.renderShell !== 'default'
  )
    return undefined
  if (native.toolDefinition?.renderCall !== nativeReadDefinition.renderCall) return undefined
  if (native.toolDefinition?.renderResult !== nativeReadDefinition.renderResult) return undefined
  const contentBox = native.contentBox
  if (!contentBox || typeof contentBox.render !== 'function') return undefined
  if (!Array.isArray(native.children) || !native.children.includes(contentBox)) return undefined
  const blocks = imageBlocks(native)
  const images = native.imageComponents
  const sources = native.imageSources
  const spacers = native.imageSpacers
  if (!Array.isArray(images) || !Array.isArray(sources) || !Array.isArray(spacers)) return undefined
  if (
    images.length !== blocks.length ||
    sources.length !== blocks.length ||
    spacers.length !== blocks.length
  )
    return undefined
  for (let index = 0; index < blocks.length; index++) {
    const image = images[index]
    const source = sources[index]
    const spacer = spacers[index]
    if (!image || typeof image.render !== 'function') return undefined
    if (!spacer || typeof spacer.render !== 'function') return undefined
    if (source?.data !== blocks[index].data || source.mimeType !== blocks[index].mimeType)
      return undefined
    if (typeof source.widthCells !== 'number') return undefined
    if (!native.children.includes(image) || !native.children.includes(spacer)) return undefined
    if (!hasRenderableImage(image, source.mimeType, width ?? source.widthCells)) return undefined
  }
  const allowed = new Set<Component>([contentBox, ...images, ...spacers])
  for (const child of native.children) {
    if (allowed.has(child as Component) || isHarmlessNativeSpacer(child)) continue
    return undefined
  }
  return { contentBox, images, spacers }
}

export function nativeImageDisclosureBody(
  row: NativeDisclosureRow,
  key: string,
  detailsKey: string,
  state: LensState,
  redraw: () => void,
  detailsHeader: Component,
): Component {
  const fallback = disclosureBody(row, key, state, redraw)
  const container = new Container()
  const refresh = (width?: number) => {
    setNativeExpanded(row, true)
    const parts = nativeImageReadParts(row, width)
    if (!parts) {
      container.children = [fallback]
      return
    }
    const children: Component[] = []
    for (let index = 0; index < parts.images.length; index++) {
      children.push(parts.spacers[index], parts.images[index])
    }
    children.push(detailsHeader)
    if (state.open.has(detailsKey)) children.push(parts.contentBox)
    container.children = children
  }
  return {
    render(width) {
      refresh(width)
      return container.render(width)
    },
    invalidate() {
      row.invalidate?.()
      for (const image of (row as NativeReadImageRow).imageComponents ?? []) clearProbeCache(image)
      container.invalidate()
    },
    handleMouse(event) {
      refresh(event.width)
      const before = state.open.has(key)
      const result = container.handleMouse(event)
      if (nativeExpanded(row)) state.open.add(key)
      else {
        state.open.delete(key)
        state.open.delete(detailsKey)
      }
      if (state.open.has(key) !== before) redraw()
      return result
    },
  }
}

export function voiceId(row: Component): string | undefined {
  if (!(row instanceof CustomMessageComponent)) return undefined
  const message = record((row as unknown as { message?: unknown }).message)
  if (message.customType !== 'pi-live-codex-delegation') return undefined
  const data = record(message.details)
  return typeof data.delegationId === 'string' ? data.delegationId : undefined
}
