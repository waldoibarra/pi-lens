import { beforeAll, expect, test } from 'bun:test'
import {
  CustomMessageComponent,
  SkillInvocationMessageComponent,
  UserMessageComponent,
  initTheme,
} from '@earendil-works/pi-coding-agent'
import { Container, Spacer, Text, visibleWidth, type Component } from '@earendil-works/pi-tui'
import { theme } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js'
import { projectTranscript } from '../src/presentation'
import { LensState } from '../src/state'

beforeAll(() => initTheme('dark', false))
const content = 'Inspect subagent updates above.\nORIGINAL_FULL_INPUT'
const message = () => Object.freeze({ role: 'user', content, timestamp: 123 })
const display = (id: string, origin: string) =>
  Object.freeze({ version: 1, input: Object.freeze({ id, origin }) })
function bind<T extends Component>(row: T, msg: object, inputDisplay: unknown, part = 'body') {
  Object.defineProperty(row, 'binding', {
    value: Object.freeze({ message: msg, inputDisplay, part }),
  })
  return row
}
const user = (
  msg: { role: string; content: string; timestamp: number },
  id: string,
  origin: string,
) => bind(new UserMessageComponent(msg.content), msg, display(id, origin))
function view(rows: Component[], state = new LensState(), expanded = false, width = 100) {
  const container = new Container()
  container.children = projectTranscript(rows, state, theme, () => {}, expanded)
  const lines = container.render(width)
  return { container, lines, text: lines.join('\n').replace(/\x1b\[[0-9;]*m/g, '') }
}
function click(container: Container, needle: string) {
  const lines = container.render(100)
  const y = lines.findIndex((line) => line.includes(needle))
  expect(y).toBeGreaterThanOrEqual(0)
  container.handleMouse({
    type: 'click',
    button: 'left',
    x: 1,
    y,
    screenX: 1,
    screenY: y,
    width: 100,
    height: lines.length,
    shift: false,
    alt: false,
    ctrl: false,
  } as never)
}

test('exact bindings distinguish identical text and timestamps without observed-event attribution', () => {
  const human = message()
  const extension = message()
  const before = JSON.stringify([human, extension])
  const rows = [user(extension, 'wake', 'extension'), user(human, 'human', 'composer')]
  for (const mode of ['normal', 'clean'] as const) {
    const state = new LensState()
    state.view = mode
    const result = view(rows, state)
    expect(result.text.match(/ORIGINAL_FULL_INPUT/g)).toHaveLength(1)
    expect(result.text.match(/You ·/g)).toHaveLength(1)
    expect(result.text.match(/▸ Extension input/g)).toHaveLength(1)
    click(result.container, 'Extension input')
    expect(state.open.has('input:wake')).toBe(true)
    expect(view(rows, state).text.match(/ORIGINAL_FULL_INPUT/g)).toHaveLength(2)
    for (const width of [1, 8, 30]) {
      for (const line of view([rows[0]], new LensState(), false, width).lines)
        expect(visibleWidth(line)).toBeLessThanOrEqual(width)
    }
  }
  expect(JSON.stringify([human, extension])).toBe(before)
})

test('skill and argument rows group once by exact message, with complete native recovery', () => {
  const msg = message()
  const metadata = display('skill-input', 'extension')
  const skill = bind(
    new SkillInvocationMessageComponent({
      name: 'demo',
      location: '/demo/SKILL.md',
      content: 'FULL_SKILL_DETAIL',
      userMessage: content,
    }),
    msg,
    metadata,
    'skill',
  )
  const args = bind(new UserMessageComponent(content), msg, metadata, 'skill-arguments')
  const rows = [skill, new Spacer(1), args]
  const state = new LensState()
  expect(view(rows, state).lines).toHaveLength(1)
  expect(view(rows, state).text.match(/Extension input/g)).toHaveLength(1)
  expect(view(rows, state).text).not.toContain('FULL_SKILL_DETAIL')
  state.open.add('input:skill-input')
  const open = view(rows, state)
  expect(open.text).toContain('FULL_SKILL_DETAIL')
  expect(open.text).toContain('ORIGINAL_FULL_INPUT')
  expect(open.container.children[0]).not.toBe(skill)
  skill.setExpanded(true)
  const native = new Container()
  native.children = rows
  expect(view(rows, state, true).lines).toEqual(native.render(100))
  expect(view(rows, state).text).not.toContain('FULL_SKILL_DETAIL')
  state.view = 'raw'
  expect(projectTranscript(rows, state, theme, () => {})).toBe(rows)
  expect(view(rows, state).lines).toEqual(native.render(100))
})

test.each(['normal', 'clean'] as const)(
  'extension skill controls retain native collapse and raw changes in %s',
  (mode) => {
    const msg = message()
    const before = JSON.stringify(msg)
    const metadata = display('native-skill', 'extension')
    const makeSkill = () =>
      bind(
        new SkillInvocationMessageComponent({
          name: 'native-demo',
          location: '/demo/SKILL.md',
          content: 'NATIVE_SKILL_DETAIL',
          userMessage: content,
        }),
        msg,
        metadata,
        'skill',
      )
    let skill = makeSkill()
    const args = bind(new UserMessageComponent(content), msg, metadata, 'skill-arguments')
    const rows = () => [skill, new Spacer(1), args]
    const state = new LensState()
    state.view = mode
    click(view(rows(), state).container, 'Extension input')
    expect(view(rows(), state).text).toContain('NATIVE_SKILL_DETAIL')
    click(view(rows(), state).container, '[skill]')
    expect(state.open.has('input:native-skill')).toBe(false)
    expect(view(rows(), state).text).not.toContain('NATIVE_SKILL_DETAIL')
    expect(skill.render(100).join('\n')).not.toContain('NATIVE_SKILL_DETAIL')

    click(view(rows(), state).container, 'Extension input')
    expect(view(rows(), state).text).toContain('NATIVE_SKILL_DETAIL')
    // Rebuilt rows restore the stable disclosure choice, including when starting in raw.
    skill = makeSkill()
    state.view = 'raw'
    expect(view(rows(), state).text).toContain('NATIVE_SKILL_DETAIL')
    click(view(rows(), state).container, '[skill]')
    state.view = mode
    expect(view(rows(), state).text).not.toContain('NATIVE_SKILL_DETAIL')
    expect(state.open.has('input:native-skill')).toBe(false)

    // A native raw-mode open must also carry back into Lens without a second click.
    state.view = 'raw'
    click(view(rows(), state).container, '[skill]')
    state.view = mode
    expect(view(rows(), state).text).toContain('NATIVE_SKILL_DETAIL')
    expect(state.open.has('input:native-skill')).toBe(true)
    expect(JSON.stringify(msg)).toBe(before)
  },
)

test('unknown, rpc, legacy, malformed and foreign rows stay visible and neutral', () => {
  for (const metadata of [
    undefined,
    display('rpc', 'rpc'),
    display('unknown', 'unknown'),
    display('bad', 'agent'),
    { version: 2, input: { id: 'bad', origin: 'extension' } },
    display('', 'extension'),
  ]) {
    const row = bind(new UserMessageComponent(content), message(), metadata)
    const result = view([row]).text
    expect(result).toContain('ORIGINAL_FULL_INPUT')
    expect(result).toContain('Input')
    expect(result).not.toContain('You')
    expect(result).not.toContain('Extension input')
  }
  const foreign = bind(new Text('APPROVAL_NATIVE', 0, 0), message(), display('x', 'extension'))
  expect(projectTranscript([foreign], new LensState(), theme, () => {})[0]).toBe(foreign)
  const notice = new CustomMessageComponent({
    role: 'custom',
    customType: 'subagent:request',
    content: 'APPROVAL_NATIVE',
    display: true,
    timestamp: 123,
  } as never)
  expect(view([notice]).text).toContain('APPROVAL_NATIVE')
  expect(view([notice]).text).not.toContain('Extension input')
})

test('rebuilt and replaced native rows retain stable input disclosure choices; branches prune them', () => {
  const state = new LensState()
  const first = message()
  state.open.add('input:stable')
  expect(view([user(first, 'stable', 'extension')], state).text).toContain('ORIGINAL_FULL_INPUT')
  const replacement = Object.freeze({ ...first, content: 'REPLACED_FULL_INPUT' })
  expect(view([user(replacement, 'stable', 'extension')], state).text).toContain(
    'REPLACED_FULL_INPUT',
  )
  state.reconcile([
    { type: 'message', message: replacement, inputDisplay: display('stable', 'extension') },
  ])
  expect(state.open.has('input:stable')).toBe(true)
  state.reconcile([])
  expect(state.open.has('input:stable')).toBe(false)
  expect(view([user(message(), 'stable', 'extension')], state).text).not.toContain(
    'ORIGINAL_FULL_INPUT',
  )
})

test('composer skill rows receive one footer even after the observed timestamp cache evicts them', () => {
  const msg = message()
  const metadata = display('composer-skill', 'composer')
  const skill = bind(
    new SkillInvocationMessageComponent({
      name: 'demo',
      location: '/demo/SKILL.md',
      content: 'SKILL_BODY',
      userMessage: content,
    }),
    msg,
    metadata,
    'skill',
  )
  const args = bind(new UserMessageComponent(content), msg, metadata, 'skill-arguments')
  const state = new LensState()
  state.observe(msg)
  for (let i = 0; i < 401; i++)
    state.observe({ role: 'user', timestamp: 1000 + i, content: 'other' })
  const text = view([skill, new Spacer(1), args], state).text
  expect(text.match(/You ·/g)).toHaveLength(1)
  expect(text).toContain('ORIGINAL_FULL_INPUT')
  expect(text).toContain('demo')
})

test('duplicate IDs and interleaved unknown rows fall back without relocating native contents', () => {
  const state = new LensState()
  const duplicate = [
    user(message(), 'collision', 'composer'),
    user(message(), 'collision', 'extension'),
  ]
  const text = view(duplicate, state).text
  expect(text.match(/ORIGINAL_FULL_INPUT/g)).toHaveLength(2)
  expect(text).not.toContain('You')
  expect(text).not.toContain('Extension input')
  const msg = message()
  const rows = [
    user(msg, 'separated', 'extension'),
    new Text('APPROVAL_NATIVE', 0, 0),
    user(msg, 'separated', 'extension'),
  ]
  const separated = view(rows, state).text
  expect(separated.indexOf('APPROVAL_NATIVE')).toBeGreaterThan(
    separated.indexOf('ORIGINAL_FULL_INPUT'),
  )
  expect(separated.lastIndexOf('ORIGINAL_FULL_INPUT')).toBeGreaterThan(
    separated.indexOf('APPROVAL_NATIVE'),
  )
  expect(separated).not.toContain('Extension input')
})

test('inconsistent group bindings cannot hide rows or transfer attribution', () => {
  const msg = message()
  const rows = [user(msg, 'same', 'composer'), user(msg, 'same', 'extension')]
  const text = view(rows).text
  expect(text.match(/ORIGINAL_FULL_INPUT/g)).toHaveLength(2)
  expect(text).not.toContain('You')
  expect(text).not.toContain('Extension input')
})
