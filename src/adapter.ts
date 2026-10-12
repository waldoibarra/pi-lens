import { Container, type Component } from '@earendil-works/pi-tui'

/** Pi 1.1 keeps header, resources, and chat in the first document container. */
export function findTranscript(tui: unknown): Container | undefined {
  const document = (tui as Container | undefined)?.children?.[0]
  if (!(document instanceof Container) || document.children.length !== 3) return undefined
  const chat = document.children[2]
  return chat instanceof Container ? chat : undefined
}

/** Own only this chat instance. Pi still walks its original children for native shortcuts. */
export function attachProjection(
  chat: Container,
  enabled: () => boolean,
  project: () => Component[],
  onFailure: (error: unknown) => void = () => {},
): () => void {
  const projection = new Container()
  let active = true
  let failed = false
  let projected = false
  let nativeBypass = false
  const render = chat.render
  const mouse = chat.handleMouse
  const descriptors = new Map(
    ['render', 'handleMouse'].map(
      (key) => [key, Object.getOwnPropertyDescriptor(chat, key)] as const,
    ),
  )
  const fail = (error: unknown) => {
    failed = true
    projected = false
    projection.clear()
    onFailure(error)
  }
  const canProject = () => active && !failed && enabled()
  const wrappedRender = function (width: number): string[] {
    projected = false
    nativeBypass = false
    if (!canProject()) return render.call(chat, width)
    let next: Component[]
    try {
      next = project()
    } catch (error) {
      fail(error)
      return render.call(chat, width)
    }
    if (next === chat.children) {
      projection.clear()
      nativeBypass = true
      return render.call(chat, width)
    }
    try {
      projection.children = next
      const lines = projection.render(width)
      projected = true
      return lines
    } catch (error) {
      fail(error)
      return render.call(chat, width)
    }
  }
  const wrappedMouse: Container['handleMouse'] = (event) => {
    if (canProject() && nativeBypass) return mouse.call(chat, event)
    if (canProject() && projected) {
      try {
        return projection.handleMouse(event)
      } catch (error) {
        fail(error)
      }
    }
    return mouse.call(chat, event)
  }
  chat.render = wrappedRender
  chat.handleMouse = wrappedMouse
  return () => {
    active = false
    projection.clear()
    for (const [key, ours] of [
      ['render', wrappedRender],
      ['handleMouse', wrappedMouse],
    ] as const) {
      if (chat[key] !== ours) continue
      const descriptor = descriptors.get(key)
      if (descriptor) Object.defineProperty(chat, key, descriptor)
      else Reflect.deleteProperty(chat, key)
    }
  }
}
