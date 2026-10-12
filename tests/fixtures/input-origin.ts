import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import {
  SkillInvocationMessageComponent,
  UserMessageComponent,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent'
import { stripTerminalSequences } from '@earendil-works/pi-tui'
import { findTranscript } from '../../src/adapter'

export const originText = 'Inspect subagent updates above.\nORIGIN_FULL_BODY'
const skillText =
  '<skill name="origin-demo" location="/fixture/SKILL.md">\nORIGIN_SKILL_BODY\n</skill>\n\nORIGIN_SKILL_ARGUMENTS'

/** Assertions inspect real host-created rows; this fixture never assigns binding metadata. */
export function registerInputOriginFixture(pi: ExtensionAPI) {
  pi.on('session_start', () => {
    writeFileSync('origin-ready', 'ready')
  })
  pi.registerCommand('fixture-origin-wake', {
    description: 'Submit a real extension-origin input identical to the composer input',
    handler: async () => {
      pi.sendUserMessage(originText)
    },
  })
  pi.registerCommand('fixture-origin-skill', {
    description: 'Submit a real multi-row skill input through the extension transport',
    handler: async () => {
      pi.sendUserMessage(skillText)
    },
  })
  pi.registerCommand('fixture-origin-assert', {
    description: 'Verify native bindings, presentation, and unchanged session messages',
    handler: async (stage, ctx) => {
      await ctx.waitForIdle()
      assert.match(stage, /^(closed|open|reload|raw|global|collapse|clean|resume)$/)
      ctx.ui.setWidget(
        'origin-assert',
        (tui) => {
          const chat = findTranscript(tui)
          assert.ok(chat)
          const branchBefore = JSON.stringify(ctx.sessionManager.getBranch())
          const rows = chat.children.filter(
            (row) =>
              row instanceof UserMessageComponent || row instanceof SkillInvocationMessageComponent,
          )
          const bindings = rows.map(
            (row) =>
              (
                row as unknown as {
                  binding: {
                    message: object
                    inputDisplay: { version: number; input: { id: string; origin: string } }
                    entryId?: string
                    part: string
                  }
                }
              ).binding,
          )
          assert.equal(bindings.length, 4)
          for (const binding of bindings) {
            assert.ok(binding?.message, 'Native host binding is required')
            assert.equal(binding.inputDisplay.version, 1)
            assert.ok(binding.inputDisplay.input.id)
          }
          assert.deepEqual(
            bindings.map((binding) => binding.inputDisplay.input.origin),
            ['composer', 'extension', 'extension', 'extension'],
          )
          assert.deepEqual(
            bindings.map((binding) => binding.part),
            ['body', 'body', 'skill', 'skill-arguments'],
          )
          assert.notEqual(bindings[0].message, bindings[1].message)
          assert.equal(bindings[2].message, bindings[3].message)
          assert.equal(bindings[2].inputDisplay.input.id, bindings[3].inputDisplay.input.id)
          assert.equal(new Set(bindings.map((binding) => binding.inputDisplay.input.id)).size, 3)
          if (stage === 'resume' || stage === 'reload') {
            assert.ok(
              bindings.every((binding) => binding.entryId),
              'Rebuilt rows have entry IDs',
            )
          }
          const render = () => chat.render(110).map(stripTerminalSequences).join('\n')
          if (stage === 'open') {
            const screen = tui as unknown as {
              getScreenLines(): string[]
              handleTerminalInput(data: string): void
              renderNow(): void
            }
            screen.renderNow()
            const before = screen.getScreenLines().map(stripTerminalSequences)
            const y = before.findIndex((line) => line.includes('Extension input · Inspect'))
            assert.ok(y >= 0, 'Wake header must be on screen before clicking')
            screen.handleTerminalInput(`\x1b[<0;3;${y + 1}M`)
            screen.handleTerminalInput(`\x1b[<0;3;${y + 1}m`)
            screen.renderNow()
            const after = screen.getScreenLines().map(stripTerminalSequences)
            assert.equal(
              after.findIndex((line) => line.includes('Extension input · Inspect')),
              y,
            )
            assert.deepEqual(after.slice(0, y), before.slice(0, y))
          }
          const text = render()
          const native = stage === 'raw' || stage === 'global'
          const open = stage === 'open' || stage === 'reload'
          assert.equal((text.match(/ORIGIN_FULL_BODY/g) ?? []).length, native || open ? 2 : 1)
          assert.equal((text.match(/You ·/g) ?? []).length, native ? 0 : 1)
          assert.equal((text.match(/Extension input/g) ?? []).length, native ? 0 : 2)
          assert.equal(text.includes('ORIGIN_SKILL_BODY'), stage === 'global')
          if (native) assert.equal(text.includes('ORIGIN_SKILL_ARGUMENTS'), true)
          else assert.equal(text.includes('ORIGIN_SKILL_ARGUMENTS'), false)
          assert.equal(JSON.stringify(ctx.sessionManager.getBranch()), branchBefore)
          writeFileSync(
            `origin-${stage}.json`,
            JSON.stringify({
              ids: bindings.map((binding) => binding.inputDisplay.input.id),
              parts: bindings.map((binding) => binding.part),
              origins: bindings.map((binding) => binding.inputDisplay.input.origin),
              text,
            }),
          )
          return { render: () => [], invalidate() {} }
        },
        { placement: 'belowEditor' },
      )
      ctx.ui.setWidget('origin-assert', undefined, { placement: 'belowEditor' })
    },
  })
}
