import {
  AssistantMessageComponent,
  CustomMessageComponent,
  ToolExecutionComponent,
  UserMessageComponent,
} from '@earendil-works/pi-coding-agent'
import { Container, Spacer, type Component } from '@earendil-works/pi-tui'

export const emptyRow: Component = { render: () => [], invalidate() {} }

/** Pi 1.1 message padding, never whitespace emitted by Markdown, tools, or images. */
export function isMessageSpacer(child: Component | undefined): boolean {
  return child instanceof Spacer && (child as unknown as { lines: number }).lines === 1
}

export function isMessageShell(child: Component | undefined): boolean {
  return (
    child instanceof AssistantMessageComponent ||
    child instanceof CustomMessageComponent ||
    child instanceof UserMessageComponent ||
    child instanceof ToolExecutionComponent
  )
}

export function compactMessageShell(native: Component, display: Component = native): Component {
  const container =
    native instanceof AssistantMessageComponent
      ? (native as unknown as { contentContainer?: Container }).contentContainer
      : native instanceof CustomMessageComponent
        ? native
        : undefined
  if (!(container instanceof Container)) return display
  return {
    render(width) {
      const children = container.children
      if (!isMessageSpacer(children[0])) return display.render(width)
      // Keep indices stable for thinking replacement and native mouse-layout caching.
      container.children = [emptyRow, ...children.slice(1)]
      try {
        return display.render(width)
      } finally {
        container.children = children
      }
    },
    invalidate() {
      display.invalidate()
    },
    handleMouse(event) {
      return display.handleMouse?.(event)
    },
  }
}
