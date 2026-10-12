// Ported pure formatting behavior from claude-code-lens ca16172.

export type LensView = 'clean' | 'normal' | 'raw'

export type LensStatus = 'running' | 'ok' | 'error' | 'interrupted'

export type LensAction = { kind: string; label: string; status: LensStatus; error?: string }

export type LensStep = {
  id: string
  turn: string
  run: number
  tool: string
  label: string
  kind: string
  status: LensStatus
  error?: string
  /** One short fact from the step's result (`exit 0`, `34 lines`). */
  detail?: string
  /** The raw error's first line, paths shortened; normal view only. */
  rawError?: string
  /** When the step started, and the model whose reply called it. */
  at?: number
  model?: string
  /** A sub-agent step: the agent it started, and the model that agent ran. */
  agentId?: string
  agentModel?: string
  /** Observed work inside an orchestration call, without copying its arguments or results. */
  actions?: LensAction[]
  failedActions?: number
}

export type Fold = {
  /** Steps folded under this line (questions excluded). */
  steps: LensStep[]
  failed: number
  running: boolean
  /** The relabeled line for the most recent failure, if any. */
  lastError?: string
}

export type QuestionPair = {
  header: string
  question: string
  answer: string
}

type Input = Record<string, unknown>

const PI_TOOL_NAMES: Record<string, string> = {
  read: 'Read',
  edit: 'Edit',
  write: 'Write',
  bash: 'Bash',
  powershell: 'Bash',
  grep: 'Grep',
  find: 'Glob',
  ls: 'Glob',
  subagent: 'Agent',
  ask_user_question: 'AskUserQuestion',
}

const canonicalTool = (tool: string): string =>
  Object.hasOwn(PI_TOOL_NAMES, tool) ? PI_TOOL_NAMES[tool] : tool

const str = (input: Input, key: string): string => {
  const value = input[key]
  return typeof value === 'string' ? value.trim() : ''
}

const baseName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? ''

const hostName = (url: string): string => {
  const match = /^[a-z]+:\/\/([^/:?#]+)/i.exec(url)
  return match?.[1] ?? ''
}

const scrub = (text: string): string =>
  text
    .replace(/(?:~|\.{1,2})?\/[\w.@-]+(?:\/[\w.@-]+)+/g, (m) => baseName(m))
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '')
    .replace(/\btoolu_[A-Za-z0-9]+\b/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

const humanize = (name: string): string =>
  name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim()

/** What kind of step a tool is, for counts: read, search, edit, command, ... */
export const stepKind = (tool: string): string => {
  const name = canonicalTool(tool)
  if (name === 'Read' || name === 'NotebookRead') return 'read'
  if (name === 'Grep' || name === 'Glob' || name === 'ToolSearch') return 'search'
  if (name === 'Edit' || name === 'Write' || name === 'NotebookEdit') return 'edit'
  if (name === 'Bash' || name === 'Monitor') return 'command'
  if (name === 'WebFetch' || name === 'WebSearch') return 'web'
  if (name === 'Agent' || name === 'Task' || name === 'SendMessage') return 'agent'
  if (name === 'AskUserQuestion') return 'question'
  if (name === 'Skill') return 'skill'
  if (name.startsWith('mcp__')) return 'integration'
  return 'other'
}

/** A plain label for one step: never the raw command, full path or an ID. */
export const stepLabel = (tool: string, raw: unknown): string => {
  const name = canonicalTool(tool)
  const input = (raw && typeof raw === 'object' ? raw : {}) as Input
  const file = baseName(
    str(input, 'file_path') || str(input, 'notebook_path') || str(input, 'path'),
  )
  switch (name) {
    case 'codemode':
      return 'Ran a tool batch'
    case 'Read':
    case 'NotebookRead':
      return file ? `Read ${file}` : 'Read a file'
    case 'Edit':
    case 'NotebookEdit':
      return file ? `Edited ${file}` : 'Edited a file'
    case 'Write':
      return file ? `Wrote ${file}` : 'Wrote a file'
    case 'Grep':
      return 'Searched the code'
    case 'Glob':
      return 'Looked for files'
    case 'ToolSearch':
      return 'Loaded tools'
    case 'Bash': {
      const description = scrub(str(input, 'description'))
      return description ? capitalize(description) : 'Ran a shell command'
    }
    case 'Monitor':
      return 'Watched a background task'
    case 'WebFetch': {
      const host = hostName(str(input, 'url'))
      return host ? `Read a page on ${host}` : 'Read a web page'
    }
    case 'WebSearch':
      return 'Searched the web'
    case 'Agent':
    case 'Task': {
      const description = scrub(str(input, 'description'))
      return description ? `Delegated: ${description}` : 'Delegated to a helper agent'
    }
    case 'SendMessage':
      return 'Messaged a helper agent'
    case 'Skill': {
      const skill = str(input, 'skill').split(':').pop() ?? ''
      return skill ? `Loaded the ${humanize(skill)} skill` : 'Loaded a skill'
    }
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
      return 'Updated the task list'
    case 'AskUserQuestion':
      return 'Asked you a question'
    case 'EnterPlanMode':
      return 'Started planning'
    case 'ExitPlanMode':
      return 'Presented a plan'
    default: {
      if (name.startsWith('mcp__')) {
        const [, server = '', method = ''] = name.split('__')
        const service = humanize(server.replace(/^claude_ai_/, ''))
        return `Used ${service}: ${humanize(method)}`
      }
      return capitalize(humanize(name)) || 'Ran a step'
    }
  }
}

const RULES: ReadonlyArray<[RegExp, string]> = [
  [
    new RegExp(
      "doesn't want to proceed|user (?:rejected|denied|declined)|" +
        'permission to use .* (?:was|has been) denied',
      'i',
    ),
    'You declined this step. Tell Pi how to proceed.',
  ],
  [
    /interrupted|aborted by user|request was aborted/i,
    'Stopped by you. Send a message to continue.',
  ],
  [
    /has not been read yet|read it first/i,
    'Pi must read the file before changing it. It will retry.',
  ],
  [
    /string to replace not found|old_string.*not found|no match(?:es)? found for|could not find (?:the exact text|edits\[\d+\])/i,
    'The text to change was not found. Pi should re-read the file.',
  ],
  [
    /found \d+ (?:matches of the string to replace|occurrences of (?:the text|edits\[\d+\]))/i,
    'The text to change appears more than once. Pi should give more context.',
  ],
  [
    /ENOENT|no such file or directory|does not exist|file not found/i,
    'File or folder not found. Check the name, or ask Pi to search for it.',
  ],
  [
    /EACCES|EPERM|permission denied|operation not permitted/i,
    'Permission denied. Check file permissions or run with access.',
  ],
  [
    /command not found|not recognized as an internal|executable file not found/i,
    'A required program is not installed. Install it or ask for another way.',
  ],
  [
    /timed? ?out|ETIMEDOUT|deadline exceeded/i,
    'The step timed out. Retry it, or run it in the background.',
  ],
  [/\b429\b|rate.?limit|too many requests/i, 'Rate limited. Wait a moment, then retry.'],
  [
    /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network|fetch failed|socket hang up|getaddrinfo/i,
    'Network request failed. Check the connection or the address.',
  ],
  [
    /\b(?:401|403)\b|unauthori[sz]ed|forbidden|authentication/i,
    'Access was refused. Sign in again or check credentials.',
  ],
  [/\b404\b|not found/i, 'Not found. Check the name or address.'],
  [
    /exit code (\d+)|exited with (?:code )?(\d+)/i,
    'The command failed (exit $1). Press Ctrl+O to see its output.',
  ],
  [
    /syntax ?error|unexpected token|parse error/i,
    'A syntax error stopped the step. Pi should fix the code and retry.',
  ],
]

const stringify = (raw: unknown): string => {
  if (typeof raw === 'string') return raw
  if (raw == null) return ''
  try {
    return JSON.stringify(raw)
  } catch {
    return String(raw)
  }
}

/** One plain line: what happened and what to do. Never the raw error text. */
export const relabelError = (raw: unknown): string => {
  const text = stringify(raw)
  for (const [pattern, line] of RULES) {
    const match = pattern.exec(text)
    if (match) return line.replace('$1', match[1] ?? match[2] ?? '?')
  }
  return 'The step failed. Press Ctrl+O to see the details.'
}

const NOUNS: Record<string, [string, string, string]> = {
  read: ['read', 'file', 'files'],
  search: ['ran', 'search', 'searches'],
  edit: ['changed', 'file', 'files'],
  command: ['ran', 'command', 'commands'],
  web: ['made', 'web lookup', 'web lookups'],
  agent: ['delegated', 'task', 'tasks'],
  skill: ['loaded', 'skill', 'skills'],
  integration: ['used', 'integration', 'integrations'],
  question: ['asked', 'question', 'questions'],
  other: ['took', 'other step', 'other steps'],
}

const ORDER = [
  'read',
  'search',
  'edit',
  'command',
  'web',
  'agent',
  'skill',
  'integration',
  'question',
  'other',
]

/** `read 2 files, ran 3 commands`: counts per kind, in a fixed order. */
export const countsSummary = (steps: readonly Pick<LensStep, 'kind' | 'actions'>[]): string => {
  const counts = new Map<string, number>()
  for (const step of steps)
    for (const action of step.actions?.length ? step.actions : [step]) {
      counts.set(action.kind, (counts.get(action.kind) ?? 0) + 1)
    }
  return ORDER.filter((kind) => counts.has(kind))
    .map((kind) => {
      const n = counts.get(kind) ?? 0
      const [verb, one, many] = NOUNS[kind] ?? NOUNS.other!
      return `${verb} ${n} ${n === 1 ? one : many}`
    })
    .join(', ')
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** Normal view lists at most this many steps per run until opened. */
export const NORMAL_MAX_STEPS = 5

/** Clean view's run line: the step count and failures, nothing more. */
export const cleanFoldLine = (fold: Fold, isOpen: boolean): string => {
  const parts = [plural(fold.steps.length, 'step', 'steps')]
  if (fold.failed > 0) parts.push(`${fold.failed} failed`)
  return `${isOpen ? '▾' : '▸'} ${parts.join(' · ')}`
}

/** Normal view's run line: counts per kind, plus failures. */
export const normalRunLine = (fold: Fold): string => {
  const summary = capitalize(countsSummary(fold.steps)) || 'No steps'
  return fold.failed > 0 ? `• ${summary} (${fold.failed} failed)` : `• ${summary}`
}

/** The raw error's first meaningful line, paths cut to file names. */
export const rawErrorLine = (failure: string | undefined): string | undefined => {
  if (!failure) return undefined
  const line = failure
    .replace(/<\/?[a-z_]+>/gi, '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '' && !/^exit code \d+$/i.test(l))
  if (!line) return undefined
  const short = line.replace(/(?:~|\.{1,2})?\/[\w.@-]+(?:\/[\w.@-]+)+/g, (m) => `…/${baseName(m)}`)
  return short.length > 160 ? `${short.slice(0, 159)}…` : short
}

export const statusGlyph = (status: LensStep['status']): string =>
  status === 'ok' ? '✓' : status === 'error' ? '✗' : status === 'interrupted' ? '◌' : '…'

/** One line for an answered AskUserQuestion call. */
export const questionLine = (output: unknown, isErrored: boolean): string => {
  if (isErrored || typeof output === 'string' || output == null) {
    return `? Question skipped. ${relabelError(output)}`
  }
  const record = output as {
    questions?: Array<{
      header?: string
      question?: string
    }>
    answers?: Record<string, string>
    response?: string
  }
  const questions = record.questions ?? []
  const answers = record.answers ?? {}
  const pairs = questions.map((q) => {
    const answer = answers[q.question ?? ''] ?? '(no answer)'
    return `${q.header || 'Question'}: ${answer}`
  })
  if (pairs.length === 0 && record.response) pairs.push(`Answer: ${record.response}`)
  return `? Answered ${pairs.join(' · ') || 'a question'}`
}

/**
 * Each question asked and the answer given, for a click to show. Questions
 * come from the result, else from the call's input (a skipped question).
 */
export const questionPairs = (input: unknown, output: unknown): QuestionPair[] => {
  type Q = {
    header?: string
    question?: string
  }
  const record = (output && typeof output === 'object' ? output : {}) as {
    questions?: Q[]
    answers?: Record<string, string>
    response?: string
  }
  const asked = (input && typeof input === 'object' ? input : {}) as { questions?: Q[] }
  const questions = record.questions ?? asked.questions ?? []
  const answers = record.answers ?? {}
  const answered = typeof output === 'object' && output !== null
  return questions.map((q, n) => ({
    header: q.header || 'Question',
    question: q.question ?? '',
    answer:
      answers[q.question ?? ''] ??
      (n === 0 && record.response ? record.response : answered ? '(no answer)' : '(skipped)'),
  }))
}

/** HH:MM at the given UTC offset in minutes (null: the runtime's local time). */
export const formatTime = (at: number, tzOffset: number | null): string => {
  const date = tzOffset === null ? new Date(at) : new Date(at + tzOffset * 60_000)
  const hours = tzOffset === null ? date.getHours() : date.getUTCHours()
  const minutes = tzOffset === null ? date.getMinutes() : date.getUTCMinutes()
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

const MODEL_FAMILIES: Record<string, string> = {
  gpt: 'GPT',
  gemini: 'Gemini',
  grok: 'Grok',
  deepseek: 'DeepSeek',
  llama: 'Llama',
  mistral: 'Mistral',
  mixtral: 'Mixtral',
  qwen: 'Qwen',
  glm: 'GLM',
  kimi: 'Kimi',
}

/** Preserve namespace and version identity; only format recognizable model families. */
function readableModelId(id: string): string {
  const slash = id.lastIndexOf('/')
  const namespace = id.slice(0, slash + 1)
  const name = id.slice(slash + 1)
  const family = /^(gpt|gemini|grok|deepseek|llama|mistral|mixtral|qwen|glm|kimi)(?=-|\d)/i.exec(
    name,
  )
  if (!family && !/^o\d+(?:-|$)/.test(name)) return id
  const words = name.split('-').map((word, index) => {
    if (index === 0)
      return family ? MODEL_FAMILIES[family[1].toLowerCase()] + word.slice(family[1].length) : word
    if (/^(?:oss|vl|\d+b|[rv]\d+(?:\.\d+)?)$/i.test(word)) return word.toUpperCase()
    return capitalize(word)
  })
  return namespace + words.join(' ')
}

/** Short Claude labels and readable known families; other non-Claude identifiers stay unchanged. */
export const modelName = (id: string | undefined): string => {
  if (id === undefined) return 'Pi'
  const original = id.trim()
  if (original === '') return 'Pi'
  const raw = original
    .toLowerCase()
    .replace(/\[.*\]$/, '')
    .replace(/^.*?(claude-)/, '$1')
  if (!raw.startsWith('claude-')) return readableModelId(original)
  const modern = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:-v\d.*)?$/.exec(raw)
  if (modern) return `${capitalize(modern[1]!)} ${modern[2]}${modern[3] ? `.${modern[3]}` : ''}`
  const legacy = /^claude-(\d+)(?:-(\d+))?-([a-z]+)/.exec(raw)
  if (legacy) return `${capitalize(legacy[3]!)} ${legacy[1]}${legacy[2] ? `.${legacy[2]}` : ''}`
  return 'Claude'
}

export const VIEWS = ['clean', 'normal', 'raw'] as const
