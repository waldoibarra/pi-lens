import {
  stepLabel,
  stepKind,
  relabelError,
  rawErrorLine,
  countsSummary,
  questionLine,
  questionPairs,
  type LensStep,
  type LensAction,
} from './domain'
import { record, textOf, type CallStamp } from './state'

export interface ToolData {
  toolName: string
  toolCallId: string
  args: unknown
  isPartial: boolean
  result?: { content: unknown; details?: unknown; isError?: boolean; durationMs?: number }
}

function batchActions(details: unknown): LensAction[] {
  const calls = record(details).calls
  if (!Array.isArray(calls)) return []
  return calls.flatMap((value): LensAction[] => {
    const call = record(value)
    if (typeof call.name !== 'string') return []
    let args: unknown = {}
    if (typeof call.args === 'string') {
      try {
        args = JSON.parse(call.args)
      } catch {
        /* Pi can truncate argument previews. */
      }
    }
    const status =
      call.status === 'ok'
        ? 'ok'
        : call.status === 'error'
          ? 'error'
          : call.status === 'cancelled'
            ? 'interrupted'
            : 'running'
    return [
      {
        kind: stepKind(call.name),
        label: stepLabel(call.name, args),
        status,
        ...(typeof call.error === 'string' ? { error: call.error } : {}),
      },
    ]
  })
}

function hasImageContent(content: unknown): boolean {
  return Array.isArray(content) && content.some((block) => record(block).type === 'image')
}

function inputPath(args: Record<string, unknown>): string {
  for (const key of ['path', 'file_path', 'notebook_path']) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function batchLabel(actions: LensAction[]): string {
  if (actions.length === 1) return actions[0].label
  if (actions.every((action) => action.kind === 'read' && action.label !== 'Read a file')) {
    const files = actions.map((action) => action.label.replace(/^Read /, ''))
    if (files.length === 2) return `Read ${files[0]} and ${files[1]}`
    const shown = files.slice(0, 3)
    return `Read ${shown.join(', ')}${files.length > shown.length ? ` and ${files.length - shown.length} more files` : ''}`
  }
  const summary = countsSummary(actions)
  return summary.charAt(0).toUpperCase() + summary.slice(1)
}

/** Convert native data once at the host boundary; never change the result or arguments. */
export function toStep(row: ToolData, stamp?: CallStamp): LensStep {
  const args = record(row.args)
  const details = record(row.result?.details)
  const output = textOf(row.result?.content)
  const scriptError = row.toolName === 'codemode' ? output.lastIndexOf('Script error:\n') : -1
  const errorOutput =
    scriptError < 0 ? output : output.slice(scriptError + 'Script error:\n'.length)
  const status =
    !row.result || row.isPartial
      ? 'running'
      : row.result.isError
        ? /interrupted|abort/i.test(errorOutput)
          ? 'interrupted'
          : 'error'
        : 'ok'
  const failure = status === 'error' || status === 'interrupted' ? errorOutput : undefined
  const kind = stepKind(row.toolName)
  const step: LensStep = {
    id: row.toolCallId,
    turn: stamp?.turn ?? '',
    run: stamp?.run ?? 0,
    tool: row.toolName,
    kind,
    label: stepLabel(row.toolName, args),
    status,
    ...(stamp ? { at: stamp.at, model: stamp.model } : {}),
  }
  const submittedPath = inputPath(args)
  if (kind === 'read' && submittedPath && hasImageContent(row.result?.content)) {
    step.label = `Read ${submittedPath}`
  }
  if (failure !== undefined) {
    step.error = relabelError(failure)
    step.rawError = rawErrorLine(failure)
  }
  if (row.toolName === 'codemode') {
    const actions = batchActions(details)
    if (actions.length) {
      step.actions = actions
      step.label = batchLabel(actions)
      const failed = actions.filter((action) => action.status === 'error')
      step.failedActions = Math.max(failed.length, status === 'error' ? 1 : 0)
      if (failed.length) step.detail = `${failed.length} failed`
      if (failed.length && failure === undefined) {
        const error = failed.at(-1)?.error
        if (!row.isPartial) step.status = 'error'
        step.error = error
          ? relabelError(error)
          : 'A tool in this batch failed. Expand for details.'
        step.rawError = rawErrorLine(error)
      } else if (actions.some((action) => action.status === 'interrupted') && status === 'ok') {
        step.status = 'interrupted'
        step.error = 'A tool in this batch was cancelled. Expand for details.'
      }
    }
  }
  if (status === 'running') return step
  if (kind === 'command') {
    const code = /(?:exit(?:ed)?(?: with)?(?: code)?[: ]+)(\d+)/i.exec(output)?.[1]
    step.detail = status === 'ok' ? 'exit 0' : code ? `exit ${code}` : undefined
  } else if (
    status === 'ok' &&
    kind === 'read' &&
    Array.isArray(row.result?.content) &&
    row.result.content.every((block) => record(block).type === 'text')
  ) {
    const body = output.replace(/\n\n\[(?:Showing|Output|File).*/s, '').replace(/\n$/, '')
    const count = body ? body.split('\n').length : 0
    step.detail = `${count} ${count === 1 ? 'line' : 'lines'}`
  } else if (status === 'ok' && kind === 'edit') {
    if (typeof details.patch === 'string') {
      const lines = details.patch.split('\n')
      const added = lines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).length
      const removed = lines.filter((line) => line.startsWith('-') && !line.startsWith('---')).length
      step.detail = `+${added} −${removed} lines`
    } else if (typeof args.content === 'string') {
      const lines = args.content.replace(/\n$/, '').split('\n')
      step.detail = `+${lines.length} lines`
    }
  }
  if (kind === 'agent') {
    const children = Array.isArray(details.results) ? details.results.map(record) : []
    const models = new Set(children.map((child) => child.model))
    const model =
      typeof details.resolvedModel === 'string'
        ? details.resolvedModel
        : children.length && models.size === 1
          ? children[0].model
          : undefined
    if (typeof model === 'string') step.agentModel = model
    if (!details.background && typeof row.result?.durationMs === 'number') {
      step.detail = `${Math.max(1, Math.round(row.result.durationMs / 1000))}s`
    }
  }
  return step
}

/** Claude-compatible question records; unknown schemas keep their native rendering. */
export function questionData(row: ToolData) {
  if (stepKind(row.toolName) !== 'question') return undefined
  const args = record(row.args)
  const details = record(row.result?.details)
  if (!row.result || row.isPartial) return { line: '? Waiting for your answer…', pairs: [] }
  if (row.result.isError) return { line: questionLine(textOf(row.result.content), true), pairs: [] }
  const output = { ...details, questions: details.questions ?? args.questions }
  if (!Array.isArray(output.questions) || (!details.answers && !details.response)) return undefined
  if (
    output.questions.some((question) => {
      const entry = record(question)
      return (
        typeof entry.question !== 'string' ||
        (entry.header !== undefined && typeof entry.header !== 'string')
      )
    })
  )
    return undefined
  if (
    details.answers !== undefined &&
    (details.answers === null ||
      typeof details.answers !== 'object' ||
      Array.isArray(details.answers) ||
      Object.values(details.answers).some((answer) => typeof answer !== 'string'))
  )
    return undefined
  if (details.response !== undefined && typeof details.response !== 'string') return undefined
  return { line: questionLine(output, false), pairs: questionPairs(args, output) }
}
