import { expect, test } from 'bun:test'
import { LensState } from '../src/state'

test('prose separates runs but tool-only assistant turns do not', () => {
  const state = new LensState()
  state.observe({ role: 'user', content: 'Inspect', timestamp: 1 })
  state.observe({
    role: 'assistant',
    model: 'gpt-6-astra',
    timestamp: 2,
    content: [
      { type: 'text', text: 'Checking' },
      { type: 'toolCall', id: 'a' },
    ],
  })
  state.observe({
    role: 'assistant',
    model: 'gpt-6-astra',
    timestamp: 3,
    content: [{ type: 'toolCall', id: 'b' }],
  })
  state.observe({
    role: 'assistant',
    model: 'claude-opus-5-5',
    timestamp: 4,
    content: [
      { type: 'text', text: 'Next' },
      { type: 'toolCall', id: 'c' },
    ],
  })
  expect(state.calls.get('a')?.run).toBe(state.calls.get('b')?.run)
  expect(state.calls.get('c')?.run).not.toBe(state.calls.get('b')?.run)
  expect(state.calls.get('c')?.model).toBe('claude-opus-5-5')
})

test('stream updates neither duplicate calls nor create false boundaries', () => {
  const state = new LensState()
  for (const text of ['Check', 'Checking'])
    state.observe({
      role: 'assistant',
      timestamp: 2,
      content: [
        { type: 'text', text },
        { type: 'toolCall', id: 'a' },
      ],
    })
  expect(state.calls.size).toBe(1)
  state.observe({ role: 'assistant', timestamp: 3, content: [{ type: 'toolCall', id: 'b' }] })
  expect(state.calls.get('a')?.run).toBe(state.calls.get('b')?.run)
})

test('repeated user prompts retain distinct stamps and separate turns', () => {
  const state = new LensState()
  for (const timestamp of [1, 3]) {
    state.observe({ role: 'user', timestamp, content: 'Again' })
    state.observe({
      role: 'assistant',
      timestamp: timestamp + 1,
      content: [{ type: 'toolCall', id: String(timestamp) }],
    })
  }
  expect(state.users.map((user) => user.at)).toEqual([1, 3])
  expect(state.calls.get('1')?.turn).not.toBe(state.calls.get('3')?.turn)
})

test('branch reconciliation removes abandoned timestamps without inventing historical observations', () => {
  const state = new LensState()
  const first = {
    role: 'user',
    content: [
      { type: 'text', text: 'Read ' },
      { type: 'text', text: 'this' },
    ],
    timestamp: 1,
  }
  state.observe(first)
  state.observe({ role: 'user', content: 'Read this', timestamp: 2 })
  state.reconcile([{ type: 'message', message: first }])
  expect(state.users).toEqual([{ at: 1, text: 'Read this' }])
  state.reconcile([{ type: 'message', message: { role: 'user', content: 'Older', timestamp: 0 } }])
  expect(state.users).toEqual([])
})

test('skill blocks bind only the user text Pi actually displays', () => {
  const state = new LensState()
  state.observe({
    role: 'user',
    timestamp: 1,
    content:
      '<skill name="review" location="/skills/review/SKILL.md">\nInstructions\n</skill>\n\nReview this',
  })
  state.observe({
    role: 'user',
    timestamp: 2,
    content: '<skill name="review" location="/skills/review/SKILL.md">\nInstructions\n</skill>',
  })
  expect(state.users).toEqual([{ at: 1, text: 'Review this' }])
})

test('branch reconciliation removes abandoned progress segment choices', () => {
  const state = new LensState()
  state.open.add('progress:100:0')
  state.open.add('progress:100:1')
  state.open.add('progress:100:2')
  state.open.add('progress:200:0')
  state.reconcile([
    {
      type: 'message',
      message: {
        role: 'assistant',
        timestamp: 100,
        content: [
          { type: 'thinking', thinking: '# First' },
          { type: 'text', text: 'Reply' },
          { type: 'thinking', thinking: '# Second' },
        ],
      },
    },
  ])
  expect([...state.open].sort()).toEqual(['progress:100:0', 'progress:100:1'])
})

test('metadata eviction does not discard active individual open choices', () => {
  const state = new LensState()
  for (let i = 0; i < 650; i++) {
    state.observe({
      role: 'assistant',
      timestamp: i + 1,
      content: [{ type: 'toolCall', id: String(i) }],
    })
    state.open.add(`step:${i}`)
  }
  expect(state.calls.size).toBe(600)
  expect(state.calls.has('0')).toBe(false)
  expect(state.open.has('step:0')).toBe(true)
})

test('branch reconciliation prunes step, run, image details, and voice opens from the active transcript', () => {
  const state = new LensState()
  state.open.add('step:kept')
  state.open.add('run:kept')
  state.open.add('image-details:kept')
  state.open.add('step:gone')
  state.open.add('run:gone')
  state.open.add('image-details:gone')
  state.open.add('voice:kept-role')
  state.open.add('voice:kept-block')
  state.open.add('voice:kept-entry')
  state.open.add('voice:gone')
  state.reconcile([
    {
      type: 'message',
      message: {
        role: 'assistant',
        timestamp: 1,
        content: [{ type: 'toolCall', id: 'kept' }],
      },
    },
    {
      type: 'message',
      message: {
        role: 'custom',
        customType: 'pi-live-codex-delegation',
        details: { delegationId: 'kept-role' },
        timestamp: 2,
      },
    },
    {
      type: 'message',
      message: {
        role: 'assistant',
        timestamp: 3,
        content: [
          {
            type: 'custom_message',
            customType: 'pi-live-codex-delegation',
            details: { delegationId: 'kept-block' },
          },
        ],
      },
    },
    {
      type: 'custom_message',
      customType: 'pi-live-codex-delegation',
      details: { delegationId: 'kept-entry' },
    },
  ])
  expect([...state.open].sort()).toEqual([
    'image-details:kept',
    'run:kept',
    'step:kept',
    'voice:kept-block',
    'voice:kept-entry',
    'voice:kept-role',
  ])
})
