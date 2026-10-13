import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { attachProjection, findTranscript } from './adapter'
import { VIEWS, stepLabel, type LensView } from './domain'
import { projectTranscript } from './presentation'
import { LensState } from './state'
import { hoverFor, type HoverController } from './hover'
import { preserveViewport, releaseViewport } from './viewport'

const SLOT = Symbol.for('pi-lens.session.v1')
type Host = typeof globalThis & { [SLOT]?: { session: string; state: LensState } }
const host = globalThis as Host
const WIDGET = 'pi-lens-adapter'

export default function lens(pi: ExtensionAPI): void {
  let state = new LensState()
  let detach: (() => void) | undefined
  let redraw = () => {}
  let tuiContext: ExtensionContext | undefined
  let ownsWorking = false
  let unavailable = false
  let hover: HoverController | undefined
  const running = new Map<string, string>()

  const restoreWorking = () => {
    if (ownsWorking) tuiContext?.ui.setStatus('pi-lens', undefined)
    ownsWorking = false
  }
  const updateWorking = () => {
    if (!tuiContext || state.view === 'raw' || detach) return restoreWorking()
    const label = [...running.values()].at(-1)
    if (label) {
      tuiContext.ui.setStatus('pi-lens', label)
      ownsWorking = true
    } else restoreWorking()
  }
  const dispose = () => {
    detach?.()
    detach = undefined
    hover?.dispose()
    hover = undefined
    redraw = () => {}
  }

  pi.registerCommand('lens', {
    description: 'Transcript view: normal (default), clean or raw',
    handler: async (args, ctx) => {
      const view = args.trim().toLowerCase()
      if ((VIEWS as readonly string[]).includes(view)) {
        if (unavailable && view !== 'raw') {
          ctx.ui.notify(
            'Lens is unavailable. Native rendering is active; reload after fixing the reported problem.',
            'warning',
          )
          return
        }
        state.view = view as LensView
        updateWorking()
        redraw()
        ctx.ui.notify(`View: ${view}.`, 'info')
      } else {
        ctx.ui.notify(`View: ${state.view}. Use /lens clean, /lens normal or /lens raw.`, 'info')
      }
    },
  })

  pi.on('session_start', (event, ctx) => {
    dispose()
    unavailable = false
    const session = ctx.sessionManager.getSessionId()
    const saved =
      event.reason === 'reload' && host[SLOT]?.session === session ? host[SLOT]!.state : undefined
    state = new LensState()
    if (saved) Object.assign(state, saved)
    host[SLOT] = { session, state }
    if (ctx.mode !== 'tui') return
    tuiContext = ctx
    ctx.ui.setWidget(
      WIDGET,
      (tui, theme) => {
        dispose()
        const chat = findTranscript(tui)
        if (!chat) {
          unavailable = true
          state.view = 'raw'
          ctx.ui.notify(
            'Lens could not attach to this Pi UI. Native rendering remains active.',
            'warning',
          )
          return { render: () => [], invalidate() {} }
        }
        const feedback = hoverFor(state)
        hover = feedback
        feedback.bind(tui, () => tui.requestRender())
        redraw = () => {
          feedback.clear()
          const selectable = tui as unknown as { resetTextSelection?: () => void }
          selectable.resetTextSelection?.()
          tui.requestRender()
        }
        const redrawDisclosure = () => {
          // Native expansion changes components now; the scroll layout updates on the next frame.
          preserveViewport(tui)
          redraw()
        }
        const detachProjection = attachProjection(
          chat,
          () => true,
          () => {
            const toolsExpanded = ctx.ui.getToolsExpanded?.() ?? false
            if (state.view === 'raw' || toolsExpanded) releaseViewport(tui)
            return projectTranscript(chat.children, state, theme, redrawDisclosure, toolsExpanded)
          },
          () => {
            unavailable = true
            state.view = 'raw'
            releaseViewport(tui)
            redraw()
            restoreWorking()
            ctx.ui.notify('Lens rendering failed. Native rendering is restored.', 'warning')
          },
        )
        detach = () => {
          detachProjection()
          releaseViewport(tui)
        }
        restoreWorking()
        return {
          render: () => {
            feedback.bind(tui, () => tui.requestRender())
            return []
          },
          invalidate() {
            feedback.clear()
          },
          dispose,
        }
      },
      { placement: 'belowEditor' },
    )
  })

  const observe = (event: { message: unknown }) => {
    if (tuiContext) state.observe(event.message)
  }
  pi.on('message_start', observe)
  pi.on('message_update', observe)
  pi.on('message_end', observe)
  pi.on('tool_execution_start', (event) => {
    if (event.parentToolCallId || !tuiContext) return
    const stamp = state.calls.get(event.toolCallId)
    if (stamp) stamp.at = Date.now()
    running.set(event.toolCallId, stepLabel(event.toolName, event.args))
    updateWorking()
  })
  pi.on('tool_execution_update', (event) => {
    if (!event.parentToolCallId) hover?.clear()
  })
  pi.on('tool_execution_end', (event) => {
    if (event.parentToolCallId) return
    hover?.clear()
    running.delete(event.toolCallId)
    updateWorking()
  })
  pi.on('agent_end', () => {
    running.clear()
    restoreWorking()
  })
  pi.on('session_tree', (_event, ctx) => {
    state.reconcile(ctx.sessionManager.getBranch())
    redraw()
  })
  pi.on('session_shutdown', (event, ctx) => {
    dispose()
    restoreWorking()
    running.clear()
    if (tuiContext) ctx.ui.setWidget(WIDGET, undefined, { placement: 'belowEditor' })
    tuiContext = undefined
    if (event.reason !== 'reload') delete host[SLOT]
  })
}
