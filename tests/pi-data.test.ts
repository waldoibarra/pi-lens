import { expect, test } from 'bun:test'
import { toStep, questionData } from '../src/pi-data'

const row = (
  toolName: string,
  args: unknown,
  text: string,
  details: unknown = {},
  isError = false,
) => ({
  toolName,
  toolCallId: 'a',
  args,
  isPartial: false,
  result: { content: [{ type: 'text', text }], details, isError },
})

test('adapts Pi built-ins without changing native results', () => {
  const read = row('read', { path: '/project/config.ts' }, 'a\nb\n')
  const before = JSON.stringify(read)
  expect(toStep(read).detail).toBe('2 lines')
  expect(toStep(read).label).toBe('Read config.ts')
  expect(JSON.stringify(read)).toBe(before)
  expect(toStep(row('bash', { command: 'npm test' }, 'ok')).detail).toBe('exit 0')
  const failed = toStep(
    row('bash', { command: 'npm test' }, 'npm ERR! failed\nCommand exited with code 2', {}, true),
  )
  expect(failed.detail).toBe('exit 2')
  expect(failed.error).toContain('exit 2')
  expect(failed.rawError).toBe('npm ERR! failed')
})

test('counts edit changes without copying the native patch', () => {
  const step = toStep(
    row('edit', { path: 'a.ts' }, 'Updated', {
      patch: '--- a.ts\n+++ a.ts\n@@ -1 +1,2 @@\n-old\n+new\n+next',
    }),
  )
  expect(step.detail).toBe('+2 −1 lines')
  expect(step).not.toHaveProperty('diff')
})

test('summary normalization never copies commands or result payloads', () => {
  const command = row('bash', { command: 'x'.repeat(5000) }, 'y'.repeat(30000))
  const summary = toStep(command)
  expect(summary).not.toHaveProperty('command')
  expect(summary).not.toHaveProperty('output')
  expect(command.result.content[0].text).toHaveLength(30000)
})

test('codemode summaries name observed actions, not the orchestration tool', () => {
  const batch = row('codemode', { code: 'opaque JavaScript' }, 'Script completed', {
    calls: [
      { name: 'read', args: '{"path":"/repo/AGENTS.md"}', status: 'ok' },
      { name: 'read', args: '{"path":"/repo/src/state.ts"}', status: 'ok' },
    ],
  })
  const summary = toStep(batch)
  expect(summary.label).toBe('Read AGENTS.md and state.ts')
  expect(summary.actions?.map((action) => action.kind)).toEqual(['read', 'read'])
  expect(summary.label).not.toContain('Codemode')
  expect(summary.label).not.toContain('/repo/')
  expect(toStep({ ...batch, isPartial: true }).label).toBe('Read AGENTS.md and state.ts')
})

test('codemode nested failures remain visible when the script catches them', () => {
  const summary = toStep(
    row('codemode', {}, 'Script completed', {
      calls: [
        { name: 'read', args: '{truncated', status: 'ok' },
        {
          name: 'bash',
          args: '{"command":"bun test"}',
          status: 'error',
          error: 'Command exited with code 2',
        },
      ],
    }),
  )
  expect(summary.label).toBe('Read 1 file, ran 1 command')
  expect(summary.status).toBe('error')
  expect(summary.error).toContain('exit 2')
  expect(summary.failedActions).toBe(1)
  expect(toStep(row('codemode', {}, '', {})).label).toBe('Ran a tool batch')
})

test('a script failure retains its own cause after a nested failure', () => {
  for (const [text, status, error] of [
    ['Caught ENOENT\nScript error:\nThe script timed out', 'error', 'timed out'],
    ['Nested call aborted\nScript error:\nThe script timed out', 'error', 'timed out'],
    ['Request was aborted', 'interrupted', 'Stopped by you'],
  ] as const) {
    const summary = toStep(
      row(
        'codemode',
        {},
        text,
        {
          calls: [
            { name: 'read', args: '{"path":"missing.txt"}', status: 'error', error: 'ENOENT' },
          ],
        },
        true,
      ),
    )
    expect(summary.status).toBe(status)
    expect(summary.error).toContain(error)
    expect(summary.failedActions).toBe(1)
  }
})

test('nested questions are included in both question-only and mixed action summaries', () => {
  const question = { name: 'ask_user_question', args: '{}', status: 'ok' }
  expect(toStep(row('codemode', {}, '', { calls: [question, question] })).label).toBe(
    'Asked 2 questions',
  )
  const mixed = toStep(
    row('codemode', {}, '', {
      calls: [{ name: 'read', args: '{"path":"a.ts"}', status: 'ok' }, question],
    }),
  )
  expect(mixed.label).toBe('Read 1 file, asked 1 question')
})

test('does not invent success while a tool is streaming or a model for mixed agents', () => {
  expect(toStep({ ...row('bash', {}, 'partial'), isPartial: true }).status).toBe('running')
  const result = row('subagent', {}, 'Done', {
    results: [{ model: 'gpt-5.5' }, { model: 'claude-opus-5-5' }],
  })
  expect(toStep(result).agentModel).toBeUndefined()
  result.result.details = { results: [{ model: 'gpt-5.5' }] }
  expect(toStep(result).agentModel).toBe('gpt-5.5')
})

test('unknown names and malformed question records keep a safe fallback', () => {
  expect(toStep(row('constructor', {}, 'Done')).kind).toBe('other')
  expect(toStep(row('__proto__', {}, 'Done')).kind).toBe('other')
  expect(
    questionData(row('ask_user_question', { questions: [null] }, '', { answers: {} })),
  ).toBeUndefined()
  expect(
    questionData(
      row('ask_user_question', { questions: [{ question: 'Where?' }] }, '', { answers: 'invalid' }),
    ),
  ).toBeUndefined()
})

test('malformed optional question headers retain native rendering', () => {
  const malformed = row('ask_user_question', {}, '', {
    questions: [{ question: 'Q', header: { toString: null } }],
    answers: { Q: 'A' },
  })
  expect(questionData(malformed)).toBeUndefined()
})

test('recognizes answered questions and retains unknown tool details', () => {
  const question = row(
    'ask_user_question',
    { questions: [{ header: 'Scope', question: 'Where?' }] },
    '',
    {
      answers: { 'Where?': 'User' },
    },
  )
  expect(questionData(question)?.line).toBe('? Answered Scope: User')
  expect(questionData(question)?.pairs[0].answer).toBe('User')
  expect(questionData(row('custom', {}, 'unknown'))).toBeUndefined()
})
