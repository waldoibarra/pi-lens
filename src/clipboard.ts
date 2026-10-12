import { UserMessageComponent, parseSkillBlock, type Theme } from '@earendil-works/pi-coding-agent'
import {
  Container,
  Image,
  Marked,
  Text,
  allocateImageId,
  getCapabilities,
  getCellDimensions,
  stripTerminalSequences,
  type Component,
} from '@earendil-works/pi-tui'
import type { ClipboardDisplay, InputBinding } from './adapter'
import { LensState, record, textOf } from './state'

export const clipboardKey = (inputId: string, imageId: string, details = false): string =>
  `${details ? 'clipboard-details' : 'clipboard'}:${JSON.stringify([inputId, imageId])}`

type Header = (label: () => string, key: string) => Component
type UserInternals = {
  text: string
  markdownTheme: ConstructorParameters<typeof UserMessageComponent>[1]
  outputPad: number
  markdownTransformers: NonNullable<ConstructorParameters<typeof UserMessageComponent>[3]>
}
type Projection = {
  original: string
  projected: Component
  mapped: Set<string>
}

const markdown = new Marked()

const bodyCache = new WeakMap<
  Component,
  { signature: string; internals: UserInternals; body: Projection }
>()
const imageCache = new WeakMap<
  LensState,
  Map<
    string,
    {
      data: string
      mimeType: string
      theme: Theme
      layout: string
      image: Image
    }
  >
>()

/** Offset arithmetic follows the host's text-block join, never occurrence searching. */
function replacements(binding: InputBinding, start: number, end: number) {
  const clipboard = binding.clipboard!
  const blocks =
    typeof binding.message.content === 'string'
      ? [{ type: 'text', text: binding.message.content }]
      : Array.isArray(binding.message.content)
        ? binding.message.content
        : []
  let offset = 0
  return blocks
    .flatMap((block, contentIndex) => {
      const value = record(block)
      if (value.type !== 'text' || typeof value.text !== 'string') return []
      const base = offset
      offset += value.text.length
      return clipboard.spans
        .filter((span) => span.contentIndex === contentIndex)
        .flatMap((span) => {
          if (base + span.start < start || base + span.end > end) return []
          const image = clipboard.images.find((image) => image.id === span.attachmentId)!
          return [{ start: base + span.start - start, end: base + span.end - start, image }]
        })
    })
    .sort((a, b) => b.start - a.start)
}

function projectBody(row: Component, binding: InputBinding): Projection | undefined {
  if (!(row instanceof UserMessageComponent)) return
  const internals = row as unknown as UserInternals
  if (
    typeof internals.text !== 'string' ||
    !internals.markdownTheme ||
    typeof internals.outputPad !== 'number' ||
    !Array.isArray(internals.markdownTransformers)
  )
    return
  const original = textOf(binding.message.content, '')
  let start = 0
  if (internals.text !== original) {
    // Native skill arguments are a known suffix. Skill bodies retain their own renderer.
    if (
      parseSkillBlock(original)?.userMessage !== internals.text ||
      !original.endsWith(internals.text)
    )
      return
    start = original.length - internals.text.length
  }
  const ranges = replacements(binding, start, start + internals.text.length)
  if (!ranges.length) return
  const signature = JSON.stringify(
    ranges.map(({ start, end, image }) => [start, end, image.id, image.number]),
  )
  const cached = bodyCache.get(row)
  if (
    cached?.signature === signature &&
    cached.body.original === internals.text &&
    cached.internals.markdownTheme === internals.markdownTheme &&
    cached.internals.outputPad === internals.outputPad &&
    cached.internals.markdownTransformers === internals.markdownTransformers
  )
    return cached.body
  // Reference resolution depends on the complete original document, including labels and definitions.
  if (Object.keys(markdown.lexer(internals.text).links).length) return
  const body: Projection = { original: internals.text, projected: row, mapped: new Set() }
  // Equal-column placeholders prevent Markdown reference labels from swallowing generated brackets.
  // Each glyph is unique to a validated range; wrapping and syntax styling cannot transfer ownership.
  const glyphs = new Map<string, string>()
  let nextGlyph = 0xe000
  const marked = ranges.map((range) => {
    const label = `[Image ${range.image.number}]`
    let marker = ''
    for (const character of label) {
      while (nextGlyph <= 0xf8ff && original.includes(String.fromCharCode(nextGlyph))) nextGlyph++
      if (nextGlyph > 0xf8ff) return undefined
      const glyph = String.fromCharCode(nextGlyph++)
      glyphs.set(glyph, character)
      marker += glyph
    }
    return { ...range, marker }
  })
  if (marked.some((range) => !range)) return
  let transformed = internals.text
  let tokenized = false
  let fallback: UserMessageComponent | undefined
  let fallbackText: string | undefined
  const projected = new UserMessageComponent(
    internals.text,
    internals.markdownTheme,
    internals.outputPad,
    [
      ...internals.markdownTransformers,
      (markdown) => {
        transformed = markdown
        tokenized = markdown === internals.text
        // Transformers receive the complete, original native document. Changed offsets are unproven.
        if (!tokenized) return markdown
        let result = markdown
        for (const range of marked) {
          result = result.slice(0, range!.start) + range!.marker + result.slice(range!.end)
        }
        return result
      },
    ],
  )
  body.projected = {
    render(width) {
      const lines = projected.render(width)
      body.mapped.clear()
      if (!tokenized) return lines
      const output = lines.join('')
      const visible = stripTerminalSequences(output)
      const links = output.match(/\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g) ?? []
      // Autolinks can duplicate visible markers into OSC destinations; never rewrite those destinations.
      if (
        [...glyphs.keys()].some(
          (glyph) => !visible.includes(glyph) || links.some((link) => link.includes(glyph)),
        )
      ) {
        if (!fallback || fallbackText !== transformed) {
          fallback = new UserMessageComponent(
            transformed,
            internals.markdownTheme,
            internals.outputPad,
            [],
          )
          fallbackText = transformed
        }
        return fallback.render(width)
      }
      for (const range of ranges) body.mapped.add(range.image.id)
      return lines.map((line) =>
        line.replace(/[\ue000-\uf8ff]/g, (glyph) => glyphs.get(glyph) ?? glyph),
      )
    },
    invalidate() {
      projected.invalidate()
      fallback?.invalidate()
    },
  }
  bodyCache.set(row, {
    signature,
    internals: {
      text: internals.text,
      markdownTheme: internals.markdownTheme,
      outputPad: internals.outputPad,
      markdownTransformers: internals.markdownTransformers,
    },
    body,
  })
  return body
}

function nativeImage(
  image: ClipboardDisplay['images'][number],
  key: string,
  state: LensState,
  theme: Theme,
): Image {
  const cache = imageCache.get(state) ?? new Map()
  imageCache.set(state, cache)
  // Retain native caches only for the current branch's runtime IDs.
  for (const id of cache.keys()) if (!state.clipboardImageIds.has(id)) cache.delete(id)
  const cached = cache.get(key)
  const cells = getCellDimensions()
  const layout = `${getCapabilities().images}:${cells.widthPx}:${cells.heightPx}`
  if (cached?.data === image.data && cached.mimeType === image.mimeType && cached.theme === theme) {
    // Raw-mode invalidation cannot reach hidden projection components.
    if (cached.layout !== layout) {
      cached.image.invalidate()
      cached.layout = layout
    }
    return cached.image
  }
  let imageId = state.clipboardImageIds.get(key)
  if (imageId === undefined) {
    imageId = allocateImageId()
    state.clipboardImageIds.set(key, imageId)
  }
  const component = new Image(
    image.data,
    image.mimeType,
    {
      fallbackColor: (text) => theme.fg('muted', text),
    },
    { imageId },
  )
  cache.set(key, { data: image.data, mimeType: image.mimeType, theme, layout, image: component })
  return component
}

/** Raw rendering owns invalidation until the projected rows return. */
export function invalidateClipboardProjection(rows: Component[], state: LensState): void {
  for (const row of rows) bodyCache.delete(row)
  for (const cached of imageCache.get(state)?.values() ?? []) cached.image.invalidate()
}

/** Captures come only from the optional host normalizer bound to this exact message. */
export function clipboardInput(
  rows: Component[],
  binding: InputBinding,
  state: LensState,
  theme: Theme,
  header: Header,
  globalExpanded = false,
): Component[] | undefined {
  if (!binding.clipboard || binding.input?.origin !== 'composer') return
  const projections = rows.map((row) => projectBody(row, binding))
  const body = rows.map((row, index) => projections[index]?.projected ?? row)
  const attachments = binding.clipboard.images.flatMap((image) => {
    const key = clipboardKey(binding.input!.id, image.id)
    const detailsKey = clipboardKey(binding.input!.id, image.id, true)
    const open = globalExpanded || state.open.has(key)
    const title = header(
      () =>
        `${open ? '▾' : '▸'} ${projections.some((p) => p?.mapped.has(image.id)) ? `[Image ${image.number}]` : 'Submitted clipboard image'}`,
      key,
    )
    if (!open) return [title]
    const detailsOpen = globalExpanded || state.open.has(detailsKey)
    const secondaryDetails = header(() => `${detailsOpen ? '▾' : '▸'} Details`, detailsKey)
    return [
      title,
      nativeImage(image, key, state, theme),
      secondaryDetails,
      ...(detailsOpen
        ? [
            ...rows,
            new Text(
              `Original path: ${image.originalPath}\nMIME type: ${image.mimeType}\nCaptured size: ${Buffer.byteLength(image.data, 'base64')} bytes`,
              1,
              0,
            ),
          ]
        : []),
    ]
  })
  const container = new Container()
  container.children = [...body, ...attachments]
  const invalidate = container.invalidate.bind(container)
  container.invalidate = () => {
    invalidate()
    // Hidden images must also retry native conversion after host invalidation.
    for (const image of binding.clipboard!.images)
      imageCache.get(state)?.get(clipboardKey(binding.input!.id, image.id))?.image.invalidate()
  }
  return [container]
}
