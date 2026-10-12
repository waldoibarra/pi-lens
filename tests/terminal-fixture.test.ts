import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'

// Run the PTY lifecycle failure test in the standard full-check gate as well as standalone.
test('terminal fixture cleans up when deadline initialization fails', () => {
  const result = spawnSync('python3', ['-B', 'tests/terminal-fixture.test.py'], {
    cwd: import.meta.dir + '/..',
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  })
  expect(result.error).toBeUndefined()
  expect(result.stderr).toContain('OK')
  expect(result.status).toBe(0)
}, 20_000)
