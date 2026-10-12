import { beforeAll, expect, test } from 'bun:test'
import { UserMessageComponent, initTheme } from '@earendil-works/pi-coding-agent'
import {
  Container,
  TuiMainScreen,
  stripTerminalSequences,
  setCapabilities,
  setImageTranscoder,
  getCellDimensions,
  setCellDimensions,
  visibleWidth,
  type Component,
  type Terminal,
} from '@earendil-works/pi-tui'
import { inflateSync } from 'node:zlib'
import { attachProjection, inputBinding } from '../src/adapter'
import { projectTranscript } from '../src/presentation'
import { theme } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js'
import { clipboardDisplay, type ClipboardDisplay, type InputBinding } from '../src/adapter'
import { clipboardInput, clipboardKey, invalidateClipboardProjection } from '../src/clipboard'
import { LensState } from '../src/state'

// A generated 2×2 RGBA PNG with verified chunk CRCs; no filesystem acquisition is simulated.
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGPQ2Jfynyvqzn8GEAHiAABMFgkR0cgD4AAAAABJRU5ErkJggg=='
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

const path = '/missing/clipboard.png'
const image = (id = 'capture-a', number = 1) => ({
  id,
  number,
  originalPath: path,
  mimeType: 'image/png',
  data: png,
})
const metadata = (
  images = [image()],
  spans = [{ attachmentId: 'capture-a', contentIndex: 0, start: 0, end: path.length }],
) => ({
  version: 1,
  input: { id: 'submission', origin: 'composer' },
  clipboard: { version: 1, images, spans },
})
// The published peer lacks clipboard normalization. Opt in to the frozen source contract without adding a dependency.
const sourceHost = process.env.PI_LENS_SOURCE_HOST
const normalize = sourceHost
  ? ((await import(`${sourceHost}/packages/coding-agent/src/core/input-display.ts`))
      .normalizeUserMessageInputDisplay as NonNullable<Parameters<typeof clipboardDisplay>[2]>)
  : undefined
const clipboardTest = test
const msg = (content: unknown = path) =>
  Object.freeze({ role: 'user' as const, content, timestamp: 123 })
const plain = (lines: string[]) => lines.join('\n').replace(/\x1b\[[0-9;]*m/g, '')
beforeAll(() => {
  initTheme('dark', false)
  setCapabilities({ images: 'kitty', trueColor: true, hyperlinks: false })
})

function fixture(
  content: unknown = path,
  data: unknown = metadata(),
  transformers: never[] = [],
  nativeText?: string,
) {
  const message = msg(content)
  const text =
    typeof content === 'string'
      ? content
      : (content as { type: string; text?: string }[])
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('')
  const row = new UserMessageComponent(nativeText ?? text, undefined, 1, transformers)
  // Portable component fixtures are already-normalized contracts, not synthetic native bindings.
  const binding: InputBinding = {
    message,
    input: { id: 'submission', origin: 'composer' },
    clipboard: normalize
      ? clipboardDisplay(data, message, normalize)
      : (data as { clipboard: ClipboardDisplay }).clipboard,
  }
  const state = new LensState()
  const header = (label: () => string, key: string): Component => ({
    render: () => [label()],
    invalidate() {},
    handleMouse: () => {
      state.toggle(key)
      return { handled: true }
    },
  })
  const render = (global = false, width = 100) => {
    const container = new Container()
    container.children = clipboardInput([row], binding, state, theme, header, global) ?? [row]
    return { lines: container.render(width), container }
  }
  return { message, row, binding, state, render }
}

clipboardTest('clipboard normalization is optional and receives the exact message owner', () => {
  const message = msg()
  expect(clipboardDisplay(metadata(), message, undefined)).toBeUndefined()
  expect(clipboardDisplay(metadata(), message, () => ({}))).toBeUndefined()
  let owner: unknown
  const expected = Object.freeze(metadata().clipboard) as ClipboardDisplay
  const result = clipboardDisplay(metadata(), message, (_value, exact) => {
    owner = exact
    return { clipboard: expected }
  })
  expect(owner).toBe(message)
  expect(result?.images[0].data).toBe(png)
  expect(Object.isFrozen(result)).toBe(true)
})

clipboardTest(
  'validated occurrences alone become tokens; repeated paths and literal labels remain literal',
  () => {
    const content = `typed ${path} [Image 1] pasted ${path} then ${path}`
    const start = content.indexOf(' pasted ') + 8
    const data = metadata(
      [image(), image('capture-b', 2)],
      [
        { attachmentId: 'capture-a', contentIndex: 0, start, end: start + path.length },
        {
          attachmentId: 'capture-b',
          contentIndex: 0,
          start: content.lastIndexOf(path),
          end: content.length,
        },
      ],
    )
    const f = fixture(content, data)
    const before = JSON.stringify(f.message)
    const text = plain(f.render().lines)
    expect(text).toContain(`typed ${path} [Image 1] pasted [Image 1] then [Image 2]`)
    expect(text).not.toContain('\x1b_G')
    expect(JSON.stringify(f.message)).toBe(before)
  },
)

clipboardTest(
  'native captured-byte image precedes secondary details and never needs its missing original file',
  () => {
    const f = fixture()
    f.state.open.add(clipboardKey('submission', 'capture-a'))
    const open = f.render().lines
    expect(open.some((line) => line.includes('\x1b_G'))).toBe(true)
    expect(plain(open)).not.toContain(path)
    expect(open.findIndex((line) => line.includes('Details'))).toBeGreaterThan(
      open.findIndex((line) => line.includes('\x1b_G')),
    )
    f.state.open.add(clipboardKey('submission', 'capture-a', true))
    const detailLines = f.render().lines
    const details = detailLines.map(stripTerminalSequences).join('\n')
    expect(details).toContain(path)
    expect(details.replace(/\s/g, '').includes(png)).toBe(false)
    expect(details).toContain('image/png')
    expect(details).toContain(`Captured size: ${Buffer.byteLength(png, 'base64')} bytes`)
    expect(detailLines.some((line) => line.includes('\x1b_G') && line.includes(png))).toBe(true)
  },
)

clipboardTest.each(['normal', 'clean'] as const)(
  'global expansion reveals clipboard previews in %s',
  (mode) => {
    const f = fixture()
    f.state.view = mode
    expect(plain(f.render(true).lines)).toContain('\x1b_G')
    expect(f.state.open.size).toBe(0)
    expect(plain(f.render().lines)).not.toContain('\x1b_G')
  },
)

test('global expansion keeps multi-megabyte capture bytes out of visible text', () => {
  // A valid PNG with a large ancillary text chunk, not a base64-only image-shaped fixture.
  const original = Buffer.from(png, 'base64')
  const payload = Buffer.concat([Buffer.from('tEXtComment\0'), Buffer.alloc(3 * 1024 * 1024, 65)])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(payload.length - 4)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(payload))
  const bytes = Buffer.concat([
    original.subarray(0, -12),
    length,
    payload,
    checksum,
    original.subarray(-12),
  ])
  const data = bytes.toString('base64')
  const f = fixture(path, metadata([{ ...image(), data }]))
  const before = JSON.stringify(f.message)
  for (const mode of ['normal', 'clean'] as const) {
    f.state.view = mode
    const lines = f.render(true).lines
    const graphics = lines.filter((line) => line.includes('\x1b_G')).join('')
    const visible = lines.map(stripTerminalSequences).join('\n')
    expect(graphics.length).toBeGreaterThan(data.length)
    expect(visible.length).toBeLessThan(4096)
    expect(visible.replace(/\s/g, '').includes(png.slice(0, 32))).toBe(false)
    expect(visible).toContain(`Captured size: ${bytes.length} bytes`)
    expect(visible).toContain(path)
    expect(visible).toContain('image/png')
  }
  expect(f.binding.clipboard!.images[0].data === data).toBe(true)
  expect(JSON.stringify(f.message)).toBe(before)
})

clipboardTest('unmapped captures retain native text and use generic capture attribution', () => {
  const data = metadata([image()], [])
  const f = fixture(path, data)
  const text = plain(f.render().lines)
  expect(text).toContain(path)
  expect(text).toContain('Submitted clipboard image')
  expect(text).not.toContain('[Image 1]')
})

test.skipIf(!normalize)(
  'source normalizer rejects malformed captures and non-composer metadata',
  () => {
    for (const data of [
      { ...metadata(), input: { id: 'submission', origin: 'extension' } },
      metadata([{ ...image(), data: 'not base64' }]),
      metadata([image(), image()]),
      metadata([{ ...image(), number: 0 }]),
      metadata([{ ...image(), originalPath: 'bad\npath' }]),
    ])
      expect(clipboardDisplay(data, msg(), normalize)).toBeUndefined()
  },
)

clipboardTest(
  'text-block UTF-16 offsets preserve surrounding Markdown, code and nontext content',
  () => {
    const content = Object.freeze([
      Object.freeze({ type: 'text', text: `😀 **bold**\n\n\`\`\`text\n${path}\n\`\`\`\n` }),
      Object.freeze({ type: 'image', data: png, mimeType: 'image/png' }),
      Object.freeze({ type: 'text', text: `tail ${path}` }),
    ] as const)
    const data = metadata(
      [image(), image('capture-b', 2)],
      [
        {
          attachmentId: 'capture-a',
          contentIndex: 0,
          start: content[0].text!.indexOf(path),
          end: content[0].text!.indexOf(path) + path.length,
        },
        { attachmentId: 'capture-b', contentIndex: 2, start: 5, end: 5 + path.length },
      ],
    )
    const f = fixture(content, data)
    const text = plain(f.render().lines)
    expect(text).toContain('bold')
    expect(text).toContain('[Image 1]')
    expect(text).toContain('tail [Image 2]')
    expect(text).not.toContain(path)
  },
)

clipboardTest(
  'native transformers see original text; changed documents keep original transformed output',
  () => {
    const seen: string[] = []
    const f = fixture(path, metadata(), [
      ((text: string) => {
        seen.push(text)
        return `TRANSFORMED ${text}`
      }) as never,
    ])
    const text = plain(f.render().lines)
    expect(seen).toEqual([path])
    expect(text).toContain(`TRANSFORMED ${path}`)
    expect(text).toContain('Submitted clipboard image')
    expect(text).not.toContain('[Image 1]')
  },
)

clipboardTest(
  'native images reuse IDs across cached renders, resize, collapse and rebuilt rows',
  () => {
    const f = fixture()
    f.state.open.add(clipboardKey('submission', 'capture-a'))
    const first = f.render().lines
    const id = first.join('').match(/,i=(\d+)/)?.[1]
    expect(id).toBeDefined()
    expect(f.render().lines).toEqual(first)
    expect(f.render(false, 30).lines.join('')).toContain(`,i=${id}`)
    f.state.open.clear()
    expect(plain(f.render().lines)).not.toContain('\x1b_G')
    f.state.open.add(clipboardKey('submission', 'capture-a'))
    expect(f.render().lines.join('')).toContain(`,i=${id}`)
    const rebuilt = new UserMessageComponent(path)
    const parts = clipboardInput([rebuilt], f.binding, f.state, theme, (label) => ({
      render: () => [label()],
      invalidate() {},
    }))!
    expect(parts.flatMap((p) => p.render(100)).join('')).toContain(`,i=${id}`)
  },
)

clipboardTest(
  'native fallback remains bounded in narrow terminals without an image protocol',
  () => {
    setCapabilities({ images: null, trueColor: true, hyperlinks: false })
    try {
      const f = fixture()
      f.state.open.add(clipboardKey('submission', 'capture-a'))
      for (const width of [8, 25, 50]) {
        const lines = f.render(false, width).lines
        expect(plain(lines)).not.toContain('\x1b_G')
        // Headers are supplied by presentation; inspect native image/text layout here.
        for (const line of lines.filter((line) => !line.startsWith('▾') && !line.startsWith('▸')))
          expect(visibleWidth(line)).toBeLessThanOrEqual(width)
      }
    } finally {
      setCapabilities({ images: 'kitty', trueColor: true, hyperlinks: false })
    }
  },
)

test('PNG fixtures contain decodable RGBA pixels and valid chunk checksums', () => {
  const bytes = Buffer.from(png, 'base64')
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  const chunks: string[] = []
  for (let offset = 8; offset < bytes.length;) {
    const size = bytes.readUInt32BE(offset)
    const kind = bytes.subarray(offset + 4, offset + 8).toString()
    const payload = bytes.subarray(offset + 4, offset + 8 + size)
    expect(crc32(payload)).toBe(bytes.readUInt32BE(offset + size + 8))
    if (kind === 'IDAT')
      expect(inflateSync(payload.subarray(4))).toEqual(
        Buffer.from([
          0, 40, 190, 100, 255, 10, 90, 220, 255, 0, 10, 90, 220, 255, 40, 190, 100, 255,
        ]),
      )
    chunks.push(kind)
    offset += size + 12
  }
  expect(chunks).toEqual(['IHDR', 'IDAT', 'IEND'])
})

test('Markdown label collisions with reference definitions retain native rendering', () => {
  const text = `${path}\n\n[Image 1]\n\n[Image 1]: https://example.invalid`
  const f = fixture(text)
  const lines = f.render().lines
  const native = f.row.render(100)
  expect(lines.slice(0, native.length)).toEqual(native)
  const output = plain(lines)
  expect(output).toContain(path)
  expect(output).toContain('Submitted clipboard image')
  expect(output).toContain('https://example.invalid')
  expect(output).not.toMatch(/[\ue000-\uf8ff]/)
})

test('invisible Markdown destinations keep native rendering and generic attachment labels', () => {
  setCapabilities({ images: 'kitty', trueColor: true, hyperlinks: true })
  try {
    const text = `[link](${path})`
    const f = fixture(
      text,
      metadata(
        [image()],
        [{ attachmentId: 'capture-a', contentIndex: 0, start: 7, end: 7 + path.length }],
      ),
    )
    const lines = f.render().lines
    const native = f.row.render(100)
    expect(lines.slice(0, native.length)).toEqual(native)
    expect(plain(lines)).toContain('Submitted clipboard image')
    expect(plain(lines)).not.toContain('[Image 1]')
    expect(plain(lines)).not.toMatch(/[\ue000-\uf8ff]/)
  } finally {
    setCapabilities({ images: 'kitty', trueColor: true, hyperlinks: false })
  }
})

test.each([
  { text: `<file://${path}>`, start: 8, destination: `file://${path}` },
  {
    text: `[${path}]\n\n[${path}]: https://example.invalid`,
    start: 1,
    destination: 'https://example.invalid',
  },
])('unsafe clipboard Markdown retains native links: $text', ({ text, start, destination }) => {
  setCapabilities({ images: 'kitty', trueColor: true, hyperlinks: true })
  try {
    const f = fixture(
      text,
      metadata(
        [image()],
        [{ attachmentId: 'capture-a', contentIndex: 0, start, end: start + path.length }],
      ),
    )
    const before = JSON.stringify(f.message)
    const native = f.row.render(100)
    expect(native.join('')).toContain(`\x1b]8;;${destination}\x1b\\`)
    const closed = f.render().lines
    expect(closed.slice(0, native.length)).toEqual(native)
    expect(closed.map(stripTerminalSequences).join('\n')).toContain('Submitted clipboard image')
    expect(closed.join('')).not.toContain('[Image 1]')
    expect(closed.join('')).not.toMatch(/[\ue000-\uf8ff]/)
    f.state.open.add(clipboardKey('submission', 'capture-a'))
    const opened = f.render().lines
    expect(opened.slice(0, native.length)).toEqual(native)
    expect(opened.some((line) => line.includes('\x1b_G') && line.includes(png))).toBe(true)
    expect(JSON.stringify(f.message)).toBe(before)
  } finally {
    setCapabilities({ images: 'kitty', trueColor: true, hyperlinks: false })
  }
})

test('unchanged native transformers retain context and cached rendering', () => {
  const seen: unknown[] = []
  const f = fixture(path, metadata(), [
    ((text: string, context: unknown) => {
      seen.push([text, context])
      return text
    }) as never,
  ])
  f.render()
  f.render()
  expect(seen).toHaveLength(1)
  expect(seen[0]).toEqual([path, { messageType: 'user', isStreaming: false, availableWidth: 98 }])
  f.render(false, 50)
  expect(seen).toHaveLength(2)
})

test('legacy runtime ignores clipboard-looking bindings without an optional normalizer', () => {
  const f = fixture()
  Object.defineProperty(f.row, 'binding', {
    value: { message: f.message, inputDisplay: metadata(), part: 'body' },
  })
  expect(inputBinding(f.row)?.clipboard).toBeUndefined()
  const state = new LensState()
  for (const view of ['normal', 'clean', 'raw'] as const) {
    state.view = view
    const rows = projectTranscript([f.row], state, theme, () => {})
    expect(plain(rows.flatMap((row) => row.render(100)))).toContain(path)
    expect(plain(rows.flatMap((row) => row.render(100)))).not.toContain('[Image 1]')
  }
})

test('adapter invalidation reaches hidden native clipboard image conversion caches', () => {
  const jpeg = { ...image(), mimeType: 'image/jpeg', data: '/9j/2Q==' }
  const f = fixture(path, metadata([jpeg]))
  const chat = new Container()
  chat.children = [f.row]
  const detach = attachProjection(
    chat,
    () => true,
    () => f.render().container.children,
  )
  setImageTranscoder(() => null)
  try {
    f.state.open.add(clipboardKey('submission', 'capture-a'))
    expect(plain(chat.render(100))).not.toContain('\x1b_G')
    f.state.open.clear()
    chat.render(100)
    setImageTranscoder(() => png)
    chat.invalidate()
    f.state.open.add(clipboardKey('submission', 'capture-a'))
    expect(plain(chat.render(100))).toContain('\x1b_G')
  } finally {
    detach()
    setImageTranscoder(undefined)
  }
})

test('native regular renderer deletes clipboard graphics on collapse and raw recovery', () => {
  let output = ''
  const terminal: Terminal = {
    columns: 100,
    rows: 90,
    kittyProtocolActive: false,
    start() {},
    stop() {},
    drainInput: async () => {},
    write(data) {
      output += data
    },
    moveBy() {},
    hideCursor() {},
    showCursor() {},
    clearLine() {},
    clearFromCursor() {},
    clearScreen() {},
    setTitle() {},
    setProgress() {},
    setProgramStatus() {},
  }
  const tui = new TuiMainScreen(terminal, false)
  const f = fixture()
  const chat = new Container()
  chat.children = [f.row]
  let raw = false
  const detach = attachProjection(
    chat,
    () => true,
    () => (raw ? chat.children : f.render().container.children),
  )
  tui.addChild(chat)
  try {
    tui.start()
    f.state.open.add(clipboardKey('submission', 'capture-a'))
    tui.renderNow()
    const id = output.match(/,i=(\d+)/)?.[1]
    expect(id).toBeDefined()
    output = ''
    f.state.open.clear()
    tui.renderNow()
    expect(output).toContain(`\x1b_Ga=d,d=I,i=${id},q=2`)
    f.state.open.add(clipboardKey('submission', 'capture-a'))
    tui.renderNow()
    output = ''
    raw = true
    tui.renderNow()
    expect(output).toContain(`\x1b_Ga=d,d=I,i=${id},q=2`)
  } finally {
    detach()
    tui.stop()
  }
})

test.skipIf(!normalize)(
  'source normalizer clears all spans on one invalid mapping without dropping captured bytes',
  () => {
    const data = metadata(
      [image(), image('capture-b', 2)],
      [
        { attachmentId: 'capture-a', contentIndex: 0, start: 0, end: path.length },
        { attachmentId: 'capture-b', contentIndex: 0, start: 1, end: path.length },
      ],
    )
    const normalized = clipboardDisplay(data, msg(), normalize)
    expect(normalized?.images).toHaveLength(2)
    expect(normalized?.spans).toEqual([])
  },
)

test('native skill argument suffixes use source offsets without searching repeated paths', () => {
  const content = `<skill name="demo" location="/demo/SKILL.md">\n${path}\n</skill>\n\nargs ${path}`
  const start = content.length - path.length
  const f = fixture(
    content,
    metadata(
      [image()],
      [{ attachmentId: 'capture-a', contentIndex: 0, start, end: content.length }],
    ),
    [],
    `args ${path}`,
  )
  expect(plain(f.render().lines)).toContain('args [Image 1]')
  expect(plain(f.render().lines)).not.toContain(path)
})

test('image layout refreshes after hidden cell-size changes without replacing its identity', () => {
  const cells = getCellDimensions()
  try {
    const f = fixture()
    f.state.open.add(clipboardKey('submission', 'capture-a'))
    const before = f.render().lines.join('')
    const id = before.match(/,i=(\d+)/)?.[1]
    expect(id).toBeDefined()
    setCellDimensions({ widthPx: cells.widthPx, heightPx: cells.heightPx * 2 })
    const after = f.render().lines.join('')
    expect(after).toContain(`,i=${id}`)
    expect(after.match(/,r=(\d+)/)?.[1]).not.toBe(before.match(/,r=(\d+)/)?.[1])
  } finally {
    setCellDimensions(cells)
  }
})

test('raw recovery invalidates projected Markdown and image caches without changing native rows', () => {
  let transformed = false
  const f = fixture(path, metadata(), [
    ((text: string) => (transformed ? `CHANGED ${text}` : text)) as never,
  ])
  expect(plain(f.render().lines)).toContain('[Image 1]')
  transformed = true
  invalidateClipboardProjection([f.row], f.state)
  const text = plain(f.render().lines)
  expect(text).toContain(`CHANGED ${path}`)
  expect(text).toContain('Submitted clipboard image')
  expect(text).not.toContain('[Image 1]')
  expect(f.message.content).toBe(path)
})
