import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { registerInputOriginFixture } from './input-origin'
import { registerClipboardFixture } from './clipboard-input'
import {
  AssistantMessageComponent,
  CustomMessageComponent,
  ToolExecutionComponent,
  createReadToolDefinition,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent'
import { findTranscript } from '../../src/adapter'
import { stripTerminalSequences } from '@earendil-works/pi-tui'
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type ToolCall,
} from '@earendil-works/pi-ai'

/** Local deterministic provider: no transport, credentials, audio, or external model calls. */
export default function fixture(pi: ExtensionAPI) {
  let turn = 0
  const origin = process.env.PI_LENS_FIXTURE_ORIGIN === '1'
  if (origin) registerInputOriginFixture(pi)
  const clipboard = process.env.PI_LENS_FIXTURE_CLIPBOARD === '1'
  if (clipboard) registerClipboardFixture(pi)
  const batch = process.env.PI_LENS_FIXTURE_BATCH === '1'
  const imageFixture = process.env.PI_LENS_FIXTURE_IMAGE === '1'
  if (imageFixture)
    pi.registerTool(createReadToolDefinition(process.cwd(), { autoResizeImages: false }))
  pi.registerProvider('lens-fixture', {
    api: 'lens-fixture-api',
    apiKey: 'fixture-only',
    baseUrl: 'http://localhost.invalid',
    models: [
      {
        id: 'gpt-6-astra-fixture',
        name: 'Lens fixture',
        reasoning: false,
        input: imageFixture ? ['text', 'image'] : ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32000,
        maxTokens: 1000,
      },
    ],
    streamSimple(model, context) {
      const stored = existsSync('fixture-context.jsonl')
        ? statSync('fixture-context.jsonl').size
        : 0
      if (stored > 1024 * 1024) throw new Error('Fixture context log exceeded 1 MiB')
      const previousCalls = stored
        ? readFileSync('fixture-context.jsonl', 'utf8').trimEnd().split('\n').length
        : 0
      if (turn >= 8 || previousCalls >= 8) throw new Error('Fixture provider call limit exceeded')
      const snapshot = JSON.stringify(context.messages) + '\n'
      if (stored + Buffer.byteLength(snapshot) > 1024 * 1024)
        throw new Error('Fixture context log exceeded 1 MiB')
      appendFileSync('fixture-context.jsonl', snapshot)
      const stream = createAssistantMessageEventStream()
      const calls = turn++ === 0 && !origin && !clipboard
      const message: AssistantMessage = {
        role: 'assistant',
        api: model.api,
        provider: model.provider,
        model: model.id,
        timestamp: Date.now(),
        stopReason: 'stop',
        content: [],
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      }
      queueMicrotask(() => {
        stream.push({ type: 'start', partial: message })
        if (calls) {
          const firstThinking =
            '**First fixture update**\nFirst reasoning detail.\n\n**Older fixture update**\nOlder reasoning detail.'
          const firstThinkingIndex = message.content.length
          message.content.push({ type: 'thinking', thinking: '' })
          stream.push({
            type: 'thinking_start',
            contentIndex: firstThinkingIndex,
            partial: message,
          })
          message.content[firstThinkingIndex] = { type: 'thinking', thinking: firstThinking }
          stream.push({
            type: 'thinking_delta',
            contentIndex: firstThinkingIndex,
            delta: firstThinking,
            partial: message,
          })
          stream.push({
            type: 'thinking_end',
            contentIndex: firstThinkingIndex,
            content: firstThinking,
            partial: message,
          })
        }
        const text = clipboard
          ? 'Clipboard fixture complete.'
          : origin
            ? 'Origin fixture complete.'
            : calls
              ? imageFixture
                ? 'Checking the fixture image.'
                : 'Checking the fixture files.'
              : imageFixture
                ? 'Fixture complete. Image read finished.'
                : 'Fixture complete. The failed command is intentional.'
        const textIndex = message.content.length
        message.content.push({ type: 'text', text: '' })
        stream.push({ type: 'text_start', contentIndex: textIndex, partial: message })
        message.content[textIndex] = { type: 'text', text }
        stream.push({ type: 'text_delta', contentIndex: textIndex, delta: text, partial: message })
        stream.push({ type: 'text_end', contentIndex: textIndex, content: text, partial: message })
        if (calls) {
          const latestThinking = '**Latest fixture update**\nLatest reasoning detail.'
          const latestThinkingIndex = message.content.length
          message.content.push({ type: 'thinking', thinking: '' })
          stream.push({
            type: 'thinking_start',
            contentIndex: latestThinkingIndex,
            partial: message,
          })
          message.content[latestThinkingIndex] = { type: 'thinking', thinking: latestThinking }
          stream.push({
            type: 'thinking_delta',
            contentIndex: latestThinkingIndex,
            delta: latestThinking,
            partial: message,
          })
          stream.push({
            type: 'thinking_end',
            contentIndex: latestThinkingIndex,
            content: latestThinking,
            partial: message,
          })
          for (let i = 0; i < (imageFixture ? 1 : batch ? 1 : 7); i++) {
            const call: ToolCall = {
              type: 'toolCall',
              id: `fixture-${i}`,
              name: imageFixture ? 'read' : batch ? 'codemode' : i === 2 ? 'bash' : 'read',
              arguments: imageFixture
                ? { path: 'fixture-image.png' }
                : batch
                  ? {
                      code: `const results = await Promise.allSettled([
                    tools.read({path: 'fixture.txt'}),
                    tools.bash({command: "printf 'Intentional fixture failure\\\\n'; exit 2"})
                  ]); for (const result of results) text(result.status === 'fulfilled' ? result.value : result.reason.message);`,
                    }
                  : i === 2
                    ? { command: "printf 'Intentional fixture failure\\n'; exit 2" }
                    : { path: 'fixture.txt' },
            }
            const contentIndex = message.content.length
            message.content.push(call)
            stream.push({ type: 'toolcall_start', contentIndex, partial: message })
            stream.push({ type: 'toolcall_end', contentIndex, toolCall: call, partial: message })
          }
          message.stopReason = 'toolUse'
        }
        stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message })
        stream.end()
      })
      return stream
    },
  })
  pi.registerCommand('fixture-assert-live-tail', {
    description: 'Assert streaming activity after native rows and asynchronous notices',
    handler: async (_args, ctx) => {
      ctx.ui.setWidget(
        'fixture-live-tail',
        (tui) => {
          const chat = findTranscript(tui)
          if (!chat) throw new Error('Missing native transcript')
          const original = chat.children
          const screen = tui as unknown as {
            renderNow(): void
            getScreenLines?: () => string[]
            captureRenderState?: () => { previousLines: string[] }
            getPrimaryScrollView?: () => { scrollToEnd(): void }
          }
          const makeTool = (id: string) =>
            new ToolExecutionComponent(
              'read',
              id,
              { path: `${id}.txt` },
              {},
              createReadToolDefinition(ctx.cwd),
              tui,
              ctx.cwd,
            )
          const toolA = makeTool('TAIL_TOOL_A')
          toolA.updateResult({ content: [{ type: 'text', text: 'complete' }], isError: false })
          const message = {
            role: 'assistant',
            timestamp: 900001,
            content: [
              { type: 'thinking', thinking: '# TAIL_THINKING_B\nInspectable thinking detail.' },
            ],
          }
          const thinking = new AssistantMessageComponent(message as never, true)
          thinking.updateContent(message as never, true)
          const notice = new CustomMessageComponent({
            role: 'custom',
            customType: 'tail-notice',
            content: 'TAIL_ASYNC_NOTICE',
            display: true,
            timestamp: 900002,
          } as never)
          const snapshots: string[][] = []
          const assertTail = (label?: string) => {
            screen.getPrimaryScrollView?.().scrollToEnd()
            screen.renderNow()
            const snapshot = (
              screen.getScreenLines?.() ??
              screen.captureRenderState?.().previousLines ??
              []
            ).map(stripTerminalSequences)
            snapshots.push(snapshot)
            const rows = chat.render(80).map(stripTerminalSequences)
            const active = rows.filter((row) => /Thinking…|Running…/.test(row))
            if (label) {
              if (active.length !== 1 || !rows.at(-1)?.includes(label))
                throw new Error(`Activity is not the single transcript tail: ${rows.join('\n')}`)
              const noticeY = snapshot.findIndex((row) => row.includes('TAIL_ASYNC_NOTICE'))
              const activeY = snapshot.findIndex((row) => row.includes(label))
              if (noticeY < 0 || activeY <= noticeY)
                throw new Error(`Activity is above asynchronous notice: ${snapshot.join('\n')}`)
            } else if (active.length) throw new Error(`Settled work advertises activity: ${active}`)
          }
          try {
            chat.children = [...original, toolA, thinking, notice]
            assertTail('Thinking… · TAIL_THINKING_B')
            const toolB = makeTool('TAIL_TOOL_B')
            chat.children = [...original, toolA, thinking, toolB, notice]
            assertTail('Running… · Read TAIL_TOOL_B.txt')
            thinking.updateContent(message as never, false)
            toolB.updateResult({ content: [{ type: 'text', text: 'complete' }], isError: false })
            assertTail()
            const cancelled = makeTool('TAIL_CANCELLED')
            cancelled.updateResult({
              content: [{ type: 'text', text: 'Interrupted' }],
              isError: true,
            })
            chat.children.push(cancelled)
            assertTail()
            writeFileSync('fixture-tail-ok', JSON.stringify(snapshots))
            ctx.ui.notify('FIXTURE_LIVE_TAIL_OK', 'info')
          } finally {
            chat.children = original
            tui.requestRender()
          }
          return { render: () => [], invalidate() {} }
        },
        { placement: 'belowEditor' },
      )
      ctx.ui.setWidget('fixture-live-tail', undefined, { placement: 'belowEditor' })
    },
  })
  pi.registerCommand('fixture-assert-activity-order', {
    description: 'Assert visible activity order from one settled screen snapshot',
    handler: async (_args, ctx) => {
      ctx.ui.setWidget(
        'fixture-activity-order',
        (tui) => {
          const screen = tui as unknown as {
            getScreenLines?: () => string[]
            captureRenderState?: () => { previousLines: string[] }
            renderNow: () => void
          }
          screen.renderNow()
          const rawLines = screen.getScreenLines
            ? screen.getScreenLines()
            : screen.captureRenderState?.().previousLines
          if (!rawLines) throw new Error('TUI does not expose a settled snapshot')
          const lines = rawLines.map(stripTerminalSequences)
          const snapshot = lines.join('\n')
          const markers = [
            'Older fixture update',
            'Checking the fixture files.',
            'Latest fixture update',
            imageFixture
              ? 'Read 1 file'
              : batch
                ? 'Read 1 file, ran 1 command'
                : 'Read 6 files, ran 1 command (1 failed)',
          ]
          let cursor = -1
          for (const marker of markers) {
            const index = snapshot.indexOf(marker, cursor + 1)
            if (index < 0) {
              throw new Error(`Missing ordered marker ${marker} in settled snapshot:\n${snapshot}`)
            }
            cursor = index
          }
          ctx.ui.notify('FIXTURE_ACTIVITY_ORDER_OK', 'info')
          return { render: () => [], invalidate() {} }
        },
        { placement: 'belowEditor' },
      )
      ctx.ui.setWidget('fixture-activity-order', undefined, { placement: 'belowEditor' })
    },
  })
  pi.registerCommand('fixture-assert-image-ui', {
    description: 'Expand image read and assert image-first default view',
    handler: async (_args, ctx) => {
      ctx.ui.setWidget(
        'fixture-image-ui',
        (tui) => {
          const screen = tui as unknown as {
            getScreenLines?: () => string[]
            captureRenderState?: () => { previousLines: string[] }
            handleTerminalInput: (data: string) => void
            renderNow: () => void
          }
          const lines = () => {
            screen.renderNow()
            const raw = screen.getScreenLines
              ? screen.getScreenLines()
              : screen.captureRenderState?.().previousLines
            if (!raw) throw new Error('TUI does not expose a settled snapshot')
            return raw
          }
          const plain = (raw: string[]) => raw.map(stripTerminalSequences).join('\n')
          const raw = lines()
          const y = raw
            .map(stripTerminalSequences)
            .findIndex((line) => line.includes('Read fixture-image.png'))
          if (y < 0) throw new Error(`Missing image read in settled snapshot:\n${plain(raw)}`)
          screen.handleTerminalInput(`\x1b[<0;3;${y + 1}M`)
          screen.handleTerminalInput(`\x1b[<0;3;${y + 1}m`)
          const expanded = lines()
          const expandedText = plain(expanded)
          const imagePlacements = (expanded.join('\n').match(/\x1b_G/g) ?? []).length
          if (imagePlacements !== 1) {
            throw new Error(
              `Expected one Kitty image placement, saw ${imagePlacements}:\n${expandedText}`,
            )
          }
          for (const hidden of ['Read image file', 'image/png', 'dimensions', '1x1']) {
            if (expandedText.includes(hidden)) {
              throw new Error(`Expanded image view leaked ${hidden}:\n${expandedText}`)
            }
          }
          if (expandedText.includes('[Image 1]')) {
            throw new Error(`Ordinary image file was tokenized:\n${expandedText}`)
          }
          writeFileSync('fixture-image-expanded-ok', 'ok')
          ctx.ui.notify('FIXTURE_IMAGE_UI_EXPANDED_OK', 'info')
          return { render: () => [], invalidate() {} }
        },
        { placement: 'belowEditor' },
      )
      ctx.ui.setWidget('fixture-image-ui', undefined, { placement: 'belowEditor' })
    },
  })
  pi.registerCommand('fixture-assert-image-details', {
    description: 'Open image Details and assert original metadata without duplicate images',
    handler: async (_args, ctx) => {
      ctx.ui.setWidget(
        'fixture-image-details',
        (tui) => {
          const screen = tui as unknown as {
            getScreenLines?: () => string[]
            captureRenderState?: () => { previousLines: string[] }
            handleTerminalInput: (data: string) => void
            renderNow: () => void
          }
          const lines = () => {
            screen.renderNow()
            const raw = screen.getScreenLines
              ? screen.getScreenLines()
              : screen.captureRenderState?.().previousLines
            if (!raw) throw new Error('TUI does not expose a settled snapshot')
            return raw
          }
          const plain = (raw: string[]) => raw.map(stripTerminalSequences).join('\n')
          const raw = lines()
          const y = raw.map(stripTerminalSequences).findIndex((line) => line.includes('Details'))
          if (y < 0) throw new Error(`Missing Details in settled snapshot:\n${plain(raw)}`)
          const beforePlain = raw.map(stripTerminalSequences)
          const beforeAbove = beforePlain.slice(0, y)
          screen.handleTerminalInput(`\x1b[<0;3;${y + 1}M`)
          screen.handleTerminalInput(`\x1b[<0;3;${y + 1}m`)
          const pinned = lines()
          const pinnedPlain = pinned.map(stripTerminalSequences)
          const pinnedY = pinnedPlain.findIndex((line) => line.includes('Details'))
          if (pinnedY !== y || pinnedPlain.slice(0, y).join('\n') !== beforeAbove.join('\n')) {
            throw new Error(
              `Details expansion moved pinned content before inspection:\nBEFORE\n${beforePlain.join('\n')}\nAFTER\n${pinnedPlain.join('\n')}`,
            )
          }
          const pinnedPlacements = (pinned.join('\n').match(/\x1b_G/g) ?? []).length
          if (pinnedPlacements > 1) {
            throw new Error(
              `Details duplicated image placement while pinned, saw ${pinnedPlacements}:\n${plain(pinned)}`,
            )
          }
          screen.handleTerminalInput('\x1b[8^')
          const details = lines()
          const detailsText = plain(details)
          const placements = (details.join('\n').match(/\x1b_G/g) ?? []).length
          if (placements > 1) {
            throw new Error(
              `Details duplicated image placement, saw ${placements}:\n${detailsText}`,
            )
          }
          for (const required of ['fixture-image.png', 'Read image file', 'image/png']) {
            if (!detailsText.includes(required)) {
              throw new Error(`Missing image metadata ${required}:\n${detailsText}`)
            }
          }
          if (detailsText.includes('[Image 1]')) {
            throw new Error(`Ordinary image metadata was tokenized:\n${detailsText}`)
          }
          writeFileSync('fixture-image-details-ok', 'ok')
          ctx.ui.notify('FIXTURE_IMAGE_DETAILS_OK', 'info')
          return { render: () => [], invalidate() {} }
        },
        { placement: 'belowEditor' },
      )
      ctx.ui.setWidget('fixture-image-details', undefined, { placement: 'belowEditor' })
    },
  })
  pi.registerCommand('fixture-open-thinking', {
    description: 'Click the synthetic thinking header through real fullscreen input dispatch',
    handler: async (_args, ctx) => {
      ctx.ui.setWidget(
        'fixture-thinking-click',
        (tui) => {
          const screen = tui as unknown as {
            getScreenLines: () => string[]
            handleTerminalInput: (data: string) => void
            renderNow: () => void
          }
          const lines = screen.getScreenLines().map(stripTerminalSequences)
          const y = lines.findIndex((line) =>
            line.includes('Thinking updates · Older fixture update'),
          )
          if (y < 0) throw new Error('Thinking fixture header is not visible')
          screen.handleTerminalInput(`\x1b[<0;3;${y + 1}M`)
          screen.handleTerminalInput(`\x1b[<0;3;${y + 1}m`)
          screen.renderNow()
          const after = screen.getScreenLines().map(stripTerminalSequences)
          const first = after.findIndex((line) => line.includes('• First fixture update'))
          const last = after.findIndex((line) => line.includes('• Older fixture update'))
          if (first < 0 || last <= first || after.slice(first, last).some((line) => !line.trim())) {
            throw new Error('Native host thinking did not render tight bullets')
          }
          ctx.ui.notify('FIXTURE_THINKING_BULLETS_OK', 'info')
          return { render: () => [], invalidate() {} }
        },
        { placement: 'belowEditor' },
      )
      ctx.ui.setWidget('fixture-thinking-click', undefined, { placement: 'belowEditor' })
    },
  })
  pi.registerCommand('fixture-voice', {
    description: 'Insert a synthetic voice delegation without opening audio',
    handler: async () => {
      pi.sendMessage({
        customType: 'pi-live-codex-delegation',
        display: true,
        content: [{ type: 'text', text: 'Inspect the voice request.\nVOICE_DETAIL_SENTINEL' }],
        details: { delegationId: 'fixture-voice', attachments: [] },
      })
    },
  })
}
