import type { Theme } from '@earendil-works/pi-coding-agent'
import { visibleWidth, type Component, type TuiMouseEvent } from '@earendil-works/pi-tui'

type Listener = (data: string) => unknown
type Target = { key: string; x: number; y: number; width: number; height: number }

/** Hover is runtime-only. It neither consumes terminal input nor owns selection or focus. */
export class HoverController {
  private active?: Target
  private listeners?: Set<Listener>
  private repaint: () => void = () => {}
  private enabled = true
  private blocked = false
  private layout?: string
  private keys: string[] = []
  private previousKeys?: string

  isHovered(key: string): boolean {
    return this.active?.key === key
  }

  move(key: string, event: TuiMouseEvent): void {
    if (!this.enabled || this.blocked) return
    const changed = this.active?.key !== key
    this.active = {
      key,
      x: event.screenX - event.x,
      y: event.screenY - event.y,
      width: event.width,
      height: event.height,
    }
    if (changed) this.refresh()
  }

  clear(): void {
    if (!this.active) return
    this.active = undefined
    this.refresh()
  }

  private refresh(): void {
    try {
      this.repaint()
    } catch {
      /* A disposed renderer must not block native input. */
    }
  }

  private observe: Listener = (data) => {
    if (!this.active) return undefined
    // Pi enables SGR mouse reporting in fullscreen. Other input invalidates the old hover rectangle.
    const match = /^\x1b\[<(\d+);(\d+);(\d+)M$/.exec(data)
    if (match) {
      const button = Number(match[1])
      const x = Number(match[2]) - 1
      const y = Number(match[3]) - 1
      const hover = this.active
      const unpressedMotion = (button & 32) !== 0 && (button & 3) === 3 && (button & 64) === 0
      if (
        unpressedMotion &&
        x >= hover.x &&
        x < hover.x + hover.width &&
        y >= hover.y &&
        y < hover.y + hover.height
      )
        return undefined
    }
    this.clear()
    return undefined
  }

  beginFrame(): void {
    this.keys = []
  }
  register(key: string): void {
    this.keys.push(key)
  }
  endFrame(): void {
    const keys = this.keys.join('\n')
    if (
      this.active &&
      (!this.keys.includes(this.active.key) ||
        (this.previousKeys !== undefined && this.previousKeys !== keys))
    )
      this.clear()
    this.previousKeys = keys
  }

  bind(tui: unknown, repaint: () => void): void {
    this.repaint = repaint
    const surface = (tui ?? {}) as {
      terminal?: { columns?: number; rows?: number }
      viewportTop?: number
      hasOverlay?: () => boolean
    }
    this.blocked = surface.hasOverlay?.() ?? false
    const layout = `${surface.terminal?.columns}:${surface.terminal?.rows}:${surface.viewportTop}:${this.blocked}`
    if (this.layout !== undefined && this.layout !== layout) this.clear()
    this.layout = layout
    const listeners = (tui as { inputListeners?: unknown } | undefined)?.inputListeners
    if (this.listeners && listeners === this.listeners) return
    this.listeners?.delete(this.observe)
    this.listeners = undefined
    this.clear()
    this.enabled =
      listeners instanceof Set && [...listeners].every((value) => typeof value === 'function')
    if (!this.enabled) return
    const set = listeners as Set<Listener>
    // The native viewport listener consumes mouse packets before public extension listeners.
    // Preserve its Set and relative order; remove only our observer during teardown.
    const existing = [...set]
    set.clear()
    set.add(this.observe)
    for (const listener of existing) set.add(listener)
    this.listeners = set
  }

  dispose(): void {
    this.listeners?.delete(this.observe)
    this.listeners = undefined
    this.active = undefined
    this.repaint = () => {}
    this.enabled = false
    this.layout = undefined
    this.keys = []
    this.previousKeys = undefined
  }
}

const controllers = new WeakMap<object, HoverController>()
export function hoverFor(state: object): HoverController {
  let controller = controllers.get(state)
  if (!controller) {
    controller = new HoverController()
    controllers.set(state, controller)
  }
  return controller
}

/** The complete painted header is the click target; motion never captures input. */
export function hoverHeader(
  child: Component,
  key: string,
  activate: () => void,
  theme: Theme,
  hover: HoverController,
): Component {
  hover.register(key)
  return {
    render(width) {
      const lines = child.render(width)
      if (!hover.isHovered(key)) return lines
      return lines.map((value) =>
        theme.bg('selectedBg', value + ' '.repeat(Math.max(0, width - visibleWidth(value)))),
      )
    },
    invalidate() {
      child.invalidate()
      hover.clear()
    },
    handleMouse(event) {
      if (event.type === 'move' && event.button === 'none') {
        hover.move(key, event)
        return undefined
      }
      if (event.type !== 'click' || event.button !== 'left') return undefined
      activate()
      return { handled: true }
    },
  }
}
