import { beforeAll, expect, test } from 'bun:test'
import {
  createReadToolDefinition,
  createBashToolDefinition,
  createEditToolDefinition,
  createWriteToolDefinition,
  ToolExecutionComponent,
  CustomMessageComponent,
  initTheme,
} from '@earendil-works/pi-coding-agent'
import {
  Container,
  Text,
  MouseRegion,
  setCapabilities,
  setImageTranscoder,
  type Component,
} from '@earendil-works/pi-tui'
import { theme } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js'
import { LensState } from '../src/state'
import { projectTranscript } from '../src/presentation'
import { nativeImageReadParts } from '../src/disclosure'

beforeAll(() => {
  initTheme('dark', false)
  setCapabilities({ images: 'kitty', trueColor: true, hyperlinks: false })
})
const ui = { requestRender() {} }
const pngImage = Object.freeze({
  type: 'image',
  mimeType: 'image/png',
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1z8AAAAASUVORK5CYII=',
})
const jpegImage = Object.freeze({
  type: 'image',
  mimeType: 'image/jpeg',
  data: '/9j/4AAQSkZJRgABAQAAAQABAAD/2w==',
})
const plain = (lines: string[]) =>
  lines
    .join('\n')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
function projected(row: ToolExecutionComponent | CustomMessageComponent, state: LensState) {
  const view = new Container()
  view.children = projectTranscript([row], state, theme, () => {})
  return view
}

test('real built-in renderers expose retained reads, commands, writes, and diffs beyond former caps', () => {
  const read =
    Array.from({ length: 2101 }, (_, index) => `line ${index} ${'x'.repeat(15)}`).join('\n') +
    '\nREAD_TAIL'
  const diff =
    Array.from({ length: 250 }, (_, index) => `+${index + 1} added`).join('\n') + '\n+251 DIFF_TAIL'
  const cases = [
    {
      definition: createReadToolDefinition('/project'),
      name: 'read',
      args: { path: 'read.txt' },
      text: read,
      details: {},
      tail: 'READ_TAIL',
    },
    {
      definition: createBashToolDefinition('/project'),
      name: 'bash',
      args: { command: 'echo ' + 'x'.repeat(4500) + ' COMMAND_TAIL' },
      text: 'BASH_OUTPUT_TAIL',
      details: {},
      tail: 'COMMAND_TAIL',
    },
    {
      definition: createWriteToolDefinition('/project'),
      name: 'write',
      args: { path: 'write.txt', content: read + '\nWRITE_TAIL' },
      text: 'Written',
      details: {},
      tail: 'WRITE_TAIL',
    },
    {
      definition: createEditToolDefinition('/project'),
      name: 'edit',
      args: { path: 'edit.txt' },
      text: 'Edited',
      details: { diff },
      tail: 'DIFF_TAIL',
    },
  ]
  for (const example of cases) {
    let executions = 0
    const definition = {
      ...example.definition,
      execute: async () => {
        executions++
        throw new Error('Must not execute')
      },
    }
    const args = Object.freeze(example.args)
    const result = Object.freeze({
      content: Object.freeze([{ type: 'text', text: example.text }]),
      details: Object.freeze(example.details),
    })
    const row = new ToolExecutionComponent(
      example.name,
      'native',
      args,
      {},
      definition as never,
      ui as never,
      '/project',
    )
    row.updateResult(result as never)
    row.setExpanded(true)
    const native = plain(row.render(100))
    row.setExpanded(false)
    const state = new LensState()
    state.open.add('step:native')
    const opened = plain(projected(row, state).render(100))
    expect(opened).toContain(native.trim())
    expect(opened).toContain(example.tail)
    expect(executions).toBe(0)
    expect((row as unknown as { args: unknown }).args).toBe(args)
    expect((row as unknown as { result: unknown }).result).toBe(result)
  }
})

test('custom native controls retain click handling without collapsing the Lens header', () => {
  let clicks = 0
  const row = new ToolExecutionComponent(
    'custom',
    'control',
    {},
    {},
    {
      renderShell: 'self',
      renderCall: () => new Text('CUSTOM_HEADER', 0, 0),
      renderResult: () =>
        new MouseRegion(new Text('CUSTOM_CONTROL', 0, 0), (event) => {
          if (event.type !== 'click') return undefined
          clicks++
          return { handled: true }
        }),
    } as never,
    ui as never,
    '/project',
  )
  row.updateResult({ content: [{ type: 'text', text: 'Result' }], isError: false })
  const state = new LensState()
  state.open.add('step:control')
  const view = projected(row, state)
  const lines = view.render(80)
  const y = lines.findIndex((line) => line.includes('CUSTOM_CONTROL'))
  view.handleMouse({
    type: 'click',
    button: 'left',
    x: 0,
    y,
    screenX: 0,
    screenY: y,
    width: 80,
    height: lines.length,
  } as never)
  expect(clicks).toBe(1)
  expect(state.open.has('step:control')).toBe(true)
})

test('streaming and empty tools remain expandable before a final result exists', () => {
  const row = new ToolExecutionComponent(
    'read',
    'pending',
    { path: 'pending.txt' },
    {},
    createReadToolDefinition('/project'),
    ui as never,
    '/project',
  )
  const state = new LensState()
  state.open.add('step:pending')
  expect(plain(projected(row, state).render(80))).toContain('pending.txt')
  row.updateResult(
    { content: [{ type: 'text', text: 'STREAMING_SENTINEL' }], isError: false },
    true,
  )
  expect(plain(projected(row, state).render(80))).toContain('STREAMING_SENTINEL')
  row.updateResult({ content: [], isError: false })
  expect(plain(projected(row, state).render(80))).toContain('▾ ✓ Read pending.txt')
})

test('voice custom renderers receive native expanded state', () => {
  const message = Object.freeze({
    role: 'custom',
    customType: 'pi-live-codex-delegation',
    content: 'Voice request',
    details: { delegationId: 'native-voice' },
    display: true,
    timestamp: 1,
  })
  const row = new CustomMessageComponent(
    message as never,
    (_message, options) =>
      new Text(options.expanded ? 'VOICE_NATIVE_EXPANDED' : 'VOICE_NATIVE_COLLAPSED', 0, 0),
  )
  const state = new LensState()
  state.open.add('voice:native-voice@1')
  const opened = plain(projected(row, state).render(80))
  expect(opened).toContain('VOICE_NATIVE_EXPANDED')
  expect(opened).not.toContain('VOICE_NATIVE_COLLAPSED')
})

test('ordinary image reads keep their submitted paths in folded headers', () => {
  const rows = ['/screenshots/a/pixel.png', '/screenshots/b/pixel.png'].map((path, index) => {
    const row = new ToolExecutionComponent(
      'read',
      `image-path-${index}`,
      { path },
      {},
      createReadToolDefinition('/project'),
      ui as never,
      '/project',
    )
    row.updateResult({
      content: [{ type: 'text', text: `Read image file [image/png]\n${path}` }, pngImage],
      isError: false,
    })
    return row
  })
  const state = new LensState()
  state.observe({
    role: 'assistant',
    timestamp: 1,
    content: rows.map((row) => ({
      type: 'toolCall',
      id: (row as unknown as { toolCallId: string }).toolCallId,
    })),
  })
  const output = plain(
    projectTranscript(rows, state, theme, () => {}).flatMap((row) => row.render(120)),
  )
  expect(output).toContain('Read /screenshots/a/pixel.png')
  expect(output).toContain('Read /screenshots/b/pixel.png')
  expect(output).not.toContain('[Image 1]')
})

test('image reads open image-first with original images and secondary technical details', () => {
  const image = Object.freeze({
    type: 'image',
    mimeType: 'image/png',
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1z8AAAAASUVORK5CYII=',
  })
  const text = Object.freeze({
    type: 'text',
    text: 'Read image file [image/png]\nTECHNICAL_SENTINEL',
  })
  const result = Object.freeze({ content: Object.freeze([text, image]), isError: false })
  const row = new ToolExecutionComponent(
    'read',
    'image',
    Object.freeze({ path: 'pixel.png' }),
    {},
    createReadToolDefinition('/project'),
    ui as never,
    '/project',
  )
  row.updateResult(result as never)
  const parts = nativeImageReadParts(row as never)
  expect(parts?.images[0]).toBe(
    (row as unknown as { imageComponents: Component[] }).imageComponents[0],
  )
  const imageLine = parts!.images[0].render(80)[0]
  const state = new LensState()
  state.open.add('step:image')
  const closedDetails = projected(row, state).render(80)
  const imageIndex = closedDetails.findIndex((line) => line.includes('\x1b_G'))
  const detailsIndex = closedDetails.findIndex((line) => line.includes('Details'))
  expect(imageIndex).toBeGreaterThanOrEqual(0)
  expect(detailsIndex).toBeGreaterThan(imageIndex)
  expect(closedDetails.join('\n').match(/\x1b_G/g)).toHaveLength(1)
  expect(closedDetails).toContain(imageLine)
  expect(plain(closedDetails)).not.toContain('TECHNICAL_SENTINEL')
  const view = projected(row, state)
  const y = view.render(80).findIndex((line) => line.includes('Details'))
  view.handleMouse({
    type: 'click',
    button: 'left',
    x: 3,
    y,
    screenX: 3,
    screenY: y,
    width: 80,
    height: view.render(80).length,
  } as never)
  expect([...state.open].sort()).toEqual(['image-details:image', 'step:image'])
  expect((row as unknown as { expanded: boolean }).expanded).toBe(true)
  const openDetails = plain(projected(row, state).render(80))
  expect(openDetails).toContain('TECHNICAL_SENTINEL')
  expect(openDetails).toContain('pixel.png')
  expect((row as unknown as { result: unknown }).result).toBe(result)
})

test('multi-image reads show every image before one secondary Details disclosure', () => {
  const row = new ToolExecutionComponent(
    'read',
    'multi-image',
    { path: 'album.png' },
    {},
    createReadToolDefinition('/project'),
    ui as never,
    '/project',
  )
  row.updateResult({
    content: [
      { type: 'text', text: 'Read image file [image/png]\nMULTI_TECHNICAL' },
      pngImage,
      pngImage,
    ],
    isError: false,
  })
  const state = new LensState()
  state.open.add('step:multi-image')
  const closed = projected(row, state).render(80)
  expect(closed.join('\n').match(/\x1b_G/g)).toHaveLength(2)
  expect(plain(closed).match(/Details/g)).toHaveLength(1)
  expect(plain(closed)).not.toContain('MULTI_TECHNICAL')
  state.open.add('image-details:multi-image')
  const open = projected(row, state).render(80)
  expect(open.join('\n').match(/\x1b_G/g)).toHaveLength(2)
  expect(plain(open)).toContain('MULTI_TECHNICAL')
})

test('image read details survive clicked replacement rows after reload', () => {
  const state = new LensState()
  const original = new ToolExecutionComponent(
    'read',
    'image-reload',
    { path: 'original.png' },
    {},
    createReadToolDefinition('/project'),
    ui as never,
    '/project',
  )
  original.updateResult({
    content: [{ type: 'text', text: 'Read image file [image/png]\nORIGINAL_TECHNICAL' }, pngImage],
    isError: false,
  })
  const first = projected(original, state)
  const headerY = first.render(80).findIndex((line) => line.includes('Read original.png'))
  first.handleMouse({
    type: 'click',
    button: 'left',
    x: 1,
    y: headerY,
    screenX: 1,
    screenY: headerY,
    width: 80,
    height: first.render(80).length,
  } as never)
  const opened = projected(original, state)
  const detailsY = opened.render(80).findIndex((line) => line.includes('Details'))
  opened.handleMouse({
    type: 'click',
    button: 'left',
    x: 3,
    y: detailsY,
    screenX: 3,
    screenY: detailsY,
    width: 80,
    height: opened.render(80).length,
  } as never)
  expect([...state.open].sort()).toEqual(['image-details:image-reload', 'step:image-reload'])
  const replacement = new ToolExecutionComponent(
    'read',
    'image-reload',
    { path: 'replacement.png' },
    {},
    createReadToolDefinition('/project'),
    ui as never,
    '/project',
  )
  replacement.updateResult({
    content: [{ type: 'text', text: 'Read image file [image/png]\nRELOAD_TECHNICAL' }, pngImage],
    isError: false,
  })
  expect(plain(projected(replacement, state).render(80))).toContain('RELOAD_TECHNICAL')
  expect((replacement as unknown as { expanded: boolean }).expanded).toBe(true)
})

test('error and partial image rows stay native boundaries', () => {
  const error = new ToolExecutionComponent(
    'read',
    'image-error',
    { path: 'broken.png' },
    {},
    createReadToolDefinition('/project'),
    ui as never,
    '/project',
  )
  error.updateResult({
    content: [{ type: 'text', text: 'Image read failed' }, pngImage],
    isError: true,
  })
  const partial = new ToolExecutionComponent(
    'read',
    'image-partial',
    { path: 'partial.png' },
    {},
    createReadToolDefinition('/project'),
    ui as never,
    '/project',
  )
  partial.updateResult(
    { content: [{ type: 'text', text: 'Partial image read' }, pngImage], isError: false },
    true,
  )
  expect(projectTranscript([error], new LensState(), theme, () => {})[0]).toBe(error)
  expect(projectTranscript([partial], new LensState(), theme, () => {})[0]).toBe(partial)

  const first = new ToolExecutionComponent(
    'read',
    'before-partial',
    { path: 'before.txt' },
    {},
    createReadToolDefinition('/project'),
    ui as never,
    '/project',
  )
  first.updateResult({ content: [{ type: 'text', text: 'before' }], isError: false })
  const after = new ToolExecutionComponent(
    'read',
    'after-partial',
    { path: 'after.txt' },
    {},
    createReadToolDefinition('/project'),
    ui as never,
    '/project',
  )
  after.updateResult({ content: [{ type: 'text', text: 'after' }], isError: false })
  const state = new LensState()
  state.observe({
    role: 'assistant',
    timestamp: 1,
    content: [
      { type: 'toolCall', id: 'before-partial' },
      { type: 'toolCall', id: 'image-partial' },
      { type: 'toolCall', id: 'after-partial' },
    ],
  })
  const output = plain(
    projectTranscript([first, partial, after], state, theme, () => {}).flatMap((row) =>
      row.render(80),
    ),
  )
  expect(output).not.toContain('Read 3 files')
})

test('image rows fall back when the native image cannot render graphics', () => {
  setCapabilities({ images: 'kitty', trueColor: true, hyperlinks: false })
  const jpeg = new ToolExecutionComponent(
    'read',
    'jpeg-image',
    { path: 'photo.jpg' },
    {},
    createReadToolDefinition('/project'),
    ui as never,
    '/project',
  )
  jpeg.updateResult({
    content: [{ type: 'text', text: 'Read image file [image/jpeg]' }, jpegImage],
    isError: false,
  })
  expect(nativeImageReadParts(jpeg as never)).toBeUndefined()
  expect(projectTranscript([jpeg], new LensState(), theme, () => {})[0]).toBe(jpeg)
})

test('JPEG probes retry after native invalidation and cache successes by width', () => {
  setCapabilities({ images: 'kitty', trueColor: true, hyperlinks: false })
  setImageTranscoder(() => null)
  const row = new ToolExecutionComponent(
    'read',
    'late-jpeg',
    { path: 'late.jpg' },
    {},
    createReadToolDefinition('/project'),
    ui as never,
    '/project',
  )
  row.updateResult({ content: [jpegImage], isError: false })
  const state = new LensState()
  const image = (row as unknown as { imageComponents: Component[] }).imageComponents[0]
  const renderImage = image.render.bind(image)
  let probes = 0
  image.render = (width) => {
    probes++
    return renderImage(width)
  }
  try {
    expect(projectTranscript([row], state, theme, () => {})[0]).toBe(row)
    expect(nativeImageReadParts(row as never, 80)).toBeUndefined()
    setImageTranscoder(() => pngImage.data)
    row.invalidate()
    expect(nativeImageReadParts(row as never, 80)).toBeDefined()
    const successful = probes
    expect(nativeImageReadParts(row as never, 80)).toBeDefined()
    expect(probes).toBe(successful)
    expect(nativeImageReadParts(row as never, 40)).toBeDefined()
    expect(probes).toBe(successful + 1)
    state.view = 'raw'
    expect(projectTranscript([row], state, theme, () => {})).toEqual([row])
    expect(probes).toBe(successful + 1)
  } finally {
    setImageTranscoder(() => null)
  }
})

test('image rows with unexpected native children fall back unchanged', () => {
  const row = new ToolExecutionComponent(
    'read',
    'unexpected-image-shape',
    { path: 'shape.png' },
    {},
    createReadToolDefinition('/project'),
    ui as never,
    '/project',
  )
  row.updateResult({
    content: [{ type: 'text', text: 'Read image file [image/png]' }, pngImage],
    isError: false,
  })
  ;(row as unknown as { children: Component[] }).children.push(
    new Text('UNEXPECTED_NATIVE_CHILD', 0, 0),
  )
  expect(nativeImageReadParts(row as never)).toBeUndefined()
  expect(projectTranscript([row], new LensState(), theme, () => {})[0]).toBe(row)
})

test('unsupported image rows retain native rendering and do not merge neighboring runs', () => {
  const first = new ToolExecutionComponent(
    'read',
    'before',
    { path: 'before.txt' },
    {},
    createReadToolDefinition('/project'),
    ui as never,
    '/project',
  )
  first.updateResult({ content: [{ type: 'text', text: 'before' }], isError: false })
  const custom = new ToolExecutionComponent(
    'read',
    'custom-image',
    { path: 'custom.png' },
    {},
    {
      renderCall: () => new Text('CUSTOM_IMAGE_NATIVE', 0, 0),
      renderResult: () => new Text('CUSTOM_TECHNICAL_NATIVE', 0, 0),
    } as never,
    ui as never,
    '/project',
  )
  custom.updateResult({
    content: [{ type: 'text', text: 'Read image file [image/png]' }, pngImage],
    isError: false,
  })
  const after = new ToolExecutionComponent(
    'read',
    'after',
    { path: 'after.txt' },
    {},
    createReadToolDefinition('/project'),
    ui as never,
    '/project',
  )
  after.updateResult({ content: [{ type: 'text', text: 'after' }], isError: false })
  const state = new LensState()
  state.observe({
    role: 'assistant',
    timestamp: 1,
    content: [
      { type: 'toolCall', id: 'before' },
      { type: 'toolCall', id: 'custom-image' },
      { type: 'toolCall', id: 'after' },
    ],
  })
  const output = plain(
    projectTranscript([first, custom, after], state, theme, () => {}).flatMap((row) =>
      row.render(80),
    ),
  )
  expect(output).toContain('CUSTOM_IMAGE_NATIVE')
  expect(output).not.toContain('Read 3 files')
  expect(projectTranscript([custom], state, theme, () => {})[0]).toBe(custom)
})
