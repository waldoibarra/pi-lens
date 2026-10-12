import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { UserMessageComponent, type ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Container, Editor, stripTerminalSequences } from '@earendil-works/pi-tui'
import { findTranscript, inputBinding } from '../../src/adapter'
import { clipboardKey } from '../../src/clipboard'
import { LensState } from '../../src/state'

export const clipboardPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGPQ2Jfynyvqzn8GEAHiAABMFgkR0cgD4AAAAABJRU5ErkJggg=='
export const clipboardPath = '/missing/lens-clipboard.png'
export const clipboardText = `typed ${clipboardPath} [Image 1] captures ${clipboardPath} + ${clipboardPath}`

/** Synthetic acquisition only. The native editor and submission pipeline own every binding and span. */
export function registerClipboardFixture(pi: ExtensionAPI) {
  pi.on('session_start', () => {
    writeFileSync('clipboard-ready', 'ready')
  })
  pi.registerCommand('fixture-clipboard-draft', {
    description: 'Insert synthetic captured bytes through the actual native editor',
    handler: async (_args, ctx) => {
      ctx.ui.setWidget(
        'clipboard-draft',
        (tui) => {
          const find = (node: unknown): Editor | undefined => {
            if (node instanceof Editor) return node
            for (const child of (node as { children?: unknown[] }).children ?? []) {
              const found = find(child)
              if (found) return found
            }
          }
          const editor = find(tui) as
            | (Editor & {
                insertClipboardImage(image: {
                  id: string
                  originalPath: string
                  mimeType: string
                  data: string
                }): void
              })
            | undefined
          assert.equal(
            typeof editor?.insertClipboardImage,
            'function',
            'Frozen clipboard host required',
          )
          editor!.setText(`typed ${clipboardPath} [Image 1] captures `)
          editor!.insertClipboardImage({
            id: 'fixture-capture-a',
            originalPath: clipboardPath,
            mimeType: 'image/png',
            data: clipboardPng,
          })
          editor!.insertTextAtCursor(' + ')
          editor!.insertClipboardImage({
            id: 'fixture-capture-b',
            originalPath: clipboardPath,
            mimeType: 'image/png',
            data: clipboardPng,
          })
          writeFileSync('clipboard-draft-ready', 'ready')
          return { render: () => [], invalidate() {} }
        },
        { placement: 'belowEditor' },
      )
      ctx.ui.setWidget('clipboard-draft', undefined, { placement: 'belowEditor' })
    },
  })
  pi.registerCommand('fixture-clipboard-assert', {
    description:
      'Verify native clipboard identity, projected previews, and unchanged provider content',
    handler: async (stage, ctx) => {
      await ctx.waitForIdle()
      assert.match(stage, /^(closed|open|details|reload|raw|global|collapse|clean|resume)$/)
      ctx.ui.setWidget(
        'clipboard-assert',
        (tui) => {
          const chat = findTranscript(tui)
          assert.ok(chat)
          const before = JSON.stringify(ctx.sessionManager.getBranch())
          const rows = chat.children.filter((row) => row instanceof UserMessageComponent)
          assert.equal(rows.length, 1)
          const binding = inputBinding(rows[0])
          assert.ok(binding?.clipboard, 'Only host-normalized native bindings count')
          assert.equal(binding.input?.origin, 'composer')
          assert.deepEqual(
            binding.clipboard.images.map((image) => image.id),
            ['fixture-capture-a', 'fixture-capture-b'],
          )
          assert.deepEqual(
            binding.clipboard.images.map((image) => image.number),
            [1, 2],
          )
          assert.equal(binding.clipboard.spans.length, 2)
          const branchState = new LensState()
          const key = clipboardKey(binding.input!.id, binding.clipboard.images[0].id)
          const detailsKey = clipboardKey(binding.input!.id, binding.clipboard.images[0].id, true)
          branchState.open.add(key)
          branchState.open.add(detailsKey)
          branchState.clipboardImageIds.set(key, 123)
          branchState.reconcile(ctx.sessionManager.getBranch())
          assert.deepEqual([...branchState.open], [key, detailsKey])
          assert.equal(branchState.clipboardImageIds.get(key), 123)
          branchState.reconcile([])
          assert.equal(branchState.open.size, 0)
          assert.equal(branchState.clipboardImageIds.size, 0)
          assert.equal(
            JSON.stringify(binding.message.content),
            JSON.stringify([{ type: 'text', text: clipboardText }]),
          )
          if (stage === 'open' || stage === 'details') {
            const screen = tui as unknown as {
              renderNow(): void
              getScreenLines(): string[]
              handleTerminalInput(data: string): void
            }
            screen.renderNow()
            const upper = screen.getScreenLines().map(stripTerminalSequences)
            const needle = stage === 'open' ? '▸ [Image 1]' : '▸ Details'
            const y = upper.findIndex((line) => line.includes(needle))
            assert.ok(y >= 0, `${needle} must be on screen before clicking`)
            screen.handleTerminalInput(`\x1b[<0;3;${y + 1}M`)
            screen.handleTerminalInput(`\x1b[<0;3;${y + 1}m`)
            screen.renderNow()
            const lower = screen.getScreenLines().map(stripTerminalSequences)
            assert.equal(
              lower.findIndex((line) => line.includes(needle.replace('▸', '▾'))),
              y,
            )
            assert.deepEqual(lower.slice(0, y), upper.slice(0, y))
          }
          const lines = chat.render(110)
          const text = lines.map(stripTerminalSequences).join('\n')
          const graphics = lines.filter((line) => line.includes('\x1b_G'))
          const expanded = ['open', 'details', 'reload', 'global'].includes(stage)
          assert.equal(graphics.length, stage === 'global' ? 2 : expanded ? 1 : 0)
          assert.ok(
            graphics.every((line) => line.includes(clipboardPng)),
            'Native graphics retain captured bytes',
          )
          assert.ok(
            !text.replace(/\s/g, '').includes(clipboardPng),
            'Captured base64 must not become visible text',
          )
          const count = (needle: string) => text.split(needle).length - 1
          const metadataCount =
            stage === 'global' ? 2 : ['details', 'reload'].includes(stage) ? 1 : 0
          assert.equal(
            count(`Captured size: ${Buffer.byteLength(clipboardPng, 'base64')} bytes`),
            metadataCount,
          )
          assert.equal(count('Original path:'), metadataCount)
          assert.equal(count('MIME type:'), metadataCount)
          if (stage === 'raw') {
            assert.deepEqual(lines, Container.prototype.render.call(chat, 110))
            assert.equal(text.split(clipboardPath).length - 1, 3)
            assert.ok(!text.includes('You ·'))
          } else {
            assert.equal(
              count(`typed ${clipboardPath} [Image 1] captures [Image 1] + [Image 2]`),
              1,
            )
            assert.equal((text.match(/You ·/g) ?? []).length, 1)
          }
          assert.equal(JSON.stringify(ctx.sessionManager.getBranch()), before)
          writeFileSync(
            `clipboard-${stage}.json`,
            JSON.stringify({
              inputId: binding.input!.id,
              imageIds: binding.clipboard.images.map((image) => image.id),
              protocolIds: graphics.map((line) => line.match(/,i=(\d+)/)?.[1]),
              text,
            }),
          )
          return { render: () => [], invalidate() {} }
        },
        { placement: 'belowEditor' },
      )
      ctx.ui.setWidget('clipboard-assert', undefined, { placement: 'belowEditor' })
    },
  })
}
