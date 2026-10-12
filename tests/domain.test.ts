import { describe, expect, test } from 'bun:test'

import type { Fold, LensStep } from '../src/domain.ts'
import {
  NORMAL_MAX_STEPS,
  VIEWS,
  cleanFoldLine,
  countsSummary,
  formatTime,
  modelName,
  normalRunLine,
  questionLine,
  questionPairs,
  rawErrorLine,
  relabelError,
  statusGlyph,
  stepKind,
  stepLabel,
} from '../src/domain.ts'

const step = (id: string, tool: string, over: Partial<LensStep> = {}): LensStep => ({
  id,
  turn: 't1',
  run: 0,
  tool,
  label: stepLabel(tool, {}),
  kind: stepKind(tool),
  status: 'ok',
  ...over,
})

describe('domain constants and types', () => {
  test('exports the fold preview count and views', () => {
    expect(NORMAL_MAX_STEPS).toBe(5)
    expect(VIEWS).toEqual(['clean', 'normal', 'raw'])
  })
})

describe('tool kinds and labels', () => {
  test('classifies Claude and lowercase Pi tool names', () => {
    const cases: Array<[string, string]> = [
      ['Read', 'read'],
      ['read', 'read'],
      ['NotebookRead', 'read'],
      ['Grep', 'search'],
      ['grep', 'search'],
      ['find', 'search'],
      ['ls', 'search'],
      ['Edit', 'edit'],
      ['write', 'edit'],
      ['bash', 'command'],
      ['powershell', 'command'],
      ['WebFetch', 'web'],
      ['subagent', 'agent'],
      ['ask_user_question', 'question'],
      ['Skill', 'skill'],
      ['mcp__svc__call', 'integration'],
      ['unknown_tool', 'other'],
    ]
    for (const [tool, kind] of cases) expect(stepKind(tool)).toBe(kind)
  })

  test('never shows raw commands, full paths, ids, or query strings', () => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['Read', { file_path: '/Users/me/project/src/app.ts' }, 'Read app.ts'],
      ['read', { path: '/Users/me/project/src/app.ts' }, 'Read app.ts'],
      ['Edit', { file_path: '/Users/me/project/README.md' }, 'Edited README.md'],
      ['write', { path: '/Users/me/project/out.txt' }, 'Wrote out.txt'],
      ['bash', { command: 'rm -rf /tmp/x && ls -la' }, 'Ran a shell command'],
      [
        'Bash',
        { command: 'rm -rf /tmp/x && ls -la', description: 'Clean the build folder' },
        'Clean the build folder',
      ],
      ['Grep', { pattern: 'TODO', path: '/Users/me' }, 'Searched the code'],
      ['find', { pattern: '**/*.ts' }, 'Looked for files'],
      ['ls', { path: '/Users/me' }, 'Looked for files'],
      ['WebFetch', { url: 'https://docs.example.com/a/b?c=1' }, 'Read a page on docs.example.com'],
      ['Agent', { description: 'Find usages', prompt: 'long prompt' }, 'Delegated: Find usages'],
      [
        'subagent',
        { description: 'Review /Users/me/project/src/app.ts' },
        'Delegated: Review app.ts',
      ],
      ['Skill', { skill: 'core:code-review' }, 'Loaded the code review skill'],
      ['mcp__claude_ai_Google_Drive__search_files', { q: 'x' }, 'Used google drive: search files'],
      ['TaskCreate', {}, 'Updated the task list'],
      ['EnterPlanMode', {}, 'Started planning'],
      ['ExitPlanMode', {}, 'Presented a plan'],
      ['weirdCustomTool', {}, 'Weird custom tool'],
    ]
    for (const [tool, input, label] of cases) {
      const got = stepLabel(tool, input)
      expect(got).toBe(label)
      expect(got).not.toMatch(/\/Users|rm -rf|git status|toolu_|\?c=1/)
    }
  })

  test('scrubs paths, ids, code spans, and malformed input from free text', () => {
    expect(
      stepLabel('Bash', {
        description:
          'Check /Users/me/project/logs/out.log using `git status` for 0c8f6b3a-1d2e-4f5a-9b8c-7d6e5f4a3b2c and toolu_abc123',
      }),
    ).toBe('Check out.log using for and')
    expect(stepLabel('Read', null)).toBe('Read a file')
    expect(stepLabel('', {})).toBe('Ran a step')
  })
})

describe('error relabeling', () => {
  test('keeps all reference classifications but uses Pi in user-facing guidance', () => {
    const cases: Array<[unknown, string]> = [
      [
        "The user doesn't want to proceed with this tool use.",
        'You declined this step. Tell Pi how to proceed.',
      ],
      ['request was aborted', 'Stopped by you. Send a message to continue.'],
      [
        'File has not been read yet. Read it first before writing to it.',
        'Pi must read the file before changing it. It will retry.',
      ],
      [
        '<tool_use_error>String to replace not found in file.</tool_use_error>',
        'The text to change was not found. Pi should re-read the file.',
      ],
      [
        'Found 3 matches of the string to replace',
        'The text to change appears more than once. Pi should give more context.',
      ],
      [
        'Error: ENOENT: no such file or directory, open /x/y.ts',
        'File or folder not found. Check the name, or ask Pi to search for it.',
      ],
      ['EACCES permission denied', 'Permission denied. Check file permissions or run with access.'],
      [
        'zsh: command not found: rg',
        'A required program is not installed. Install it or ask for another way.',
      ],
      ['deadline exceeded', 'The step timed out. Retry it, or run it in the background.'],
      ['Request failed with status 429', 'Rate limited. Wait a moment, then retry.'],
      [
        'connect ECONNREFUSED 127.0.0.1:5432',
        'Network request failed. Check the connection or the address.',
      ],
      ['HTTP 403 forbidden', 'Access was refused. Sign in again or check credentials.'],
      ['HTTP 404', 'Not found. Check the name or address.'],
      [
        'Exit code 2\nnpm ERR! missing script',
        'The command failed (exit 2). Press Ctrl+O to see its output.',
      ],
      [
        'syntax error near unexpected token',
        'A syntax error stopped the step. Pi should fix the code and retry.',
      ],
      ['something nobody anticipated', 'The step failed. Press Ctrl+O to see the details.'],
      [
        { message: 'ENOENT' },
        'File or folder not found. Check the name, or ask Pi to search for it.',
      ],
      [null, 'The step failed. Press Ctrl+O to see the details.'],
    ]
    for (const [raw, line] of cases) {
      const got = relabelError(raw)
      expect(got).toBe(line)
      expect(got).not.toContain('\n')
    }
  })

  test('recognizes Pi exact-edit wording confirmed by its edit tool', () => {
    expect(
      relabelError(
        'Could not find the exact text in src/app.ts. The old text must match exactly including all whitespace and newlines.',
      ),
    ).toBe('The text to change was not found. Pi should re-read the file.')
    expect(
      relabelError('Could not find edits[1] in src/app.ts. The oldText must match exactly.'),
    ).toBe('The text to change was not found. Pi should re-read the file.')
    expect(
      relabelError(
        'Found 2 occurrences of edits[0] in src/app.ts. Each oldText must be unique. Please provide more context.',
      ),
    ).toBe('The text to change appears more than once. Pi should give more context.')
  })
})

describe('fold counts and lines', () => {
  const failedCommand = step('c', 'Bash', {
    status: 'error',
    error: 'The command failed (exit 1). Press Ctrl+O to see its output.',
  })

  test('clean fold lines show step and failure counts', () => {
    const fold: Fold = {
      steps: [step('a', 'Read'), step('b', 'Read'), failedCommand, step('d', 'Edit', { run: 1 })],
      failed: 1,
      running: false,
      lastError: failedCommand.error,
    }
    expect(fold.steps.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(fold.failed).toBe(1)
    expect(fold.running).toBe(false)
    expect(fold.lastError).toBe('The command failed (exit 1). Press Ctrl+O to see its output.')
    expect(cleanFoldLine(fold, false)).toBe('▸ 4 steps · 1 failed')
    expect(cleanFoldLine(fold, true)).toBe('▾ 4 steps · 1 failed')
  })

  test('normal fold lines summarize run steps by kind', () => {
    expect(
      normalRunLine({
        steps: [step('a', 'Read'), step('b', 'Read'), failedCommand],
        failed: 1,
        running: false,
      }),
    ).toBe('• Read 2 files, ran 1 command (1 failed)')
    expect(normalRunLine({ steps: [step('d', 'Edit')], failed: 0, running: false })).toBe(
      '• Changed 1 file',
    )
    expect(countsSummary([step('x', 'Grep'), step('y', 'Glob'), step('w', 'WebSearch')])).toBe(
      'ran 2 searches, made 1 web lookup',
    )
  })

  test('batch counts describe the observed nested work', () => {
    expect(
      countsSummary([
        {
          kind: 'other',
          actions: [
            { kind: 'read', label: 'Read a.ts', status: 'ok' },
            { kind: 'read', label: 'Read b.ts', status: 'ok' },
            { kind: 'command', label: 'Ran a shell command', status: 'ok' },
          ],
        },
      ]),
    ).toBe('read 2 files, ran 1 command')
  })

  test('running state and empty summaries are explicit', () => {
    const running: Fold = {
      steps: [step('x', 'bash', { status: 'running' })],
      failed: 0,
      running: true,
    }
    expect(running.running).toBe(true)
    expect(normalRunLine({ steps: [], failed: 0, running: false })).toBe('• No steps')
  })
})

describe('status, time, and model names', () => {
  test('renders status glyphs and fixed-offset times', () => {
    expect(statusGlyph('ok')).toBe('✓')
    expect(statusGlyph('error')).toBe('✗')
    expect(statusGlyph('interrupted')).toBe('◌')
    expect(statusGlyph('running')).toBe('…')
    expect(formatTime(Date.UTC(2024, 0, 1, 6, 5), 0)).toBe('06:05')
    expect(formatTime(Date.UTC(2024, 0, 1, 6, 5), -360)).toBe('00:05')
  })

  test('preserves the existing Claude model labels', () => {
    expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelName('claude-fable-5-1')).toBe('Fable 5.1')
    expect(modelName('claude-sonnet-5-5[1m]')).toBe('Sonnet 5.5')
    expect(modelName('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
    expect(modelName('us.anthropic.claude-haiku-5-5-v1:0')).toBe('Haiku 5.5')
    expect(modelName('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5')
    expect(modelName('claude-opus-4')).toBe('Opus 4')
    expect(modelName('claude-future')).toBe('Claude')
    expect(modelName(undefined)).toBe('Pi')
  })

  test('humanizes recognized model families without losing versions or namespace identity', () => {
    const cases = [
      ['gpt-6-astra', 'GPT 6 Astra'],
      ['gpt-6.1-sol', 'GPT 6.1 Sol'],
      ['gpt-5-codex', 'GPT 5 Codex'],
      ['gpt-4o-mini', 'GPT 4o Mini'],
      ['gpt-oss-120b', 'GPT OSS 120B'],
      ['gemini-2.5-flash', 'Gemini 2.5 Flash'],
      ['grok-4-fast', 'Grok 4 Fast'],
      ['deepseek-r1', 'DeepSeek R1'],
      ['llama-3.3-70b-instruct', 'Llama 3.3 70B Instruct'],
      ['mistral-small-3.2', 'Mistral Small 3.2'],
      ['Qwen/Qwen3-Coder', 'Qwen/Qwen3 Coder'],
      ['openai-codex/gpt-6-astra', 'openai-codex/GPT 6 Astra'],
      ['o3-mini', 'o3 Mini'],
    ]
    for (const [id, name] of cases) expect(modelName(id)).toBe(name)
    for (const id of ['custom-deployment-17', 'GPT 6 Astra', 'vendor/private-model']) {
      expect(modelName(id)).toBe(id)
    }
  })
})

describe('step errors in normal view', () => {
  test('the raw error keeps its first meaningful line with paths shortened', () => {
    expect(
      rawErrorLine('Exit code 1\nls: /nonexistent/lens-probe: No such file or directory'),
    ).toBe('ls: …/lens-probe: No such file or directory')
    expect(
      rawErrorLine('<tool_use_error>String to replace not found in file.</tool_use_error>'),
    ).toBe('String to replace not found in file.')
    expect(rawErrorLine('x'.repeat(300))).toHaveLength(160)
    expect(rawErrorLine(undefined)).toBeUndefined()
  })
})

describe('questions', () => {
  test('folds answered and skipped question calls into one line', () => {
    const output = {
      questions: [
        { header: 'Library', question: 'Which library?', options: [], multiSelect: false },
      ],
      answers: { 'Which library?': 'date-fns' },
    }
    expect(questionLine(output, false)).toBe('? Answered Library: date-fns')
    expect(questionLine({ response: 'yes' }, false)).toBe('? Answered Answer: yes')
    expect(questionLine("The user doesn't want to proceed", true)).toBe(
      '? Question skipped. You declined this step. Tell Pi how to proceed.',
    )
    expect(questionLine(null, false)).toBe(
      '? Question skipped. The step failed. Press Ctrl+O to see the details.',
    )
  })

  test('pairs each question with its answer or skipped state', () => {
    const asked = {
      questions: [
        { header: 'Lib', question: 'Which library?' },
        { header: 'Scope', question: 'Which scope?' },
      ],
    }
    expect(questionPairs(asked, { ...asked, answers: { 'Which library?': 'date-fns' } })).toEqual([
      { header: 'Lib', question: 'Which library?', answer: 'date-fns' },
      { header: 'Scope', question: 'Which scope?', answer: '(no answer)' },
    ])
    expect(questionPairs(asked, { questions: asked.questions, response: 'date-fns' })).toEqual([
      { header: 'Lib', question: 'Which library?', answer: 'date-fns' },
      { header: 'Scope', question: 'Which scope?', answer: '(no answer)' },
    ])
    expect(questionPairs(asked, "The user doesn't want to proceed")).toEqual([
      { header: 'Lib', question: 'Which library?', answer: '(skipped)' },
      { header: 'Scope', question: 'Which scope?', answer: '(skipped)' },
    ])
    expect(questionPairs(null, null)).toEqual([])
  })
})
