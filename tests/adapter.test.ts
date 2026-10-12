import { describe, expect, test } from 'bun:test'
import { Container, Text } from '@earendil-works/pi-tui'
import { attachProjection, findTranscript } from '../src/adapter'

describe('instance-local transcript adapter', () => {
  test('renders a separate projection without changing authoritative children', () => {
    const chat = new Container()
    const native = new Text('native', 0, 0)
    chat.addChild(native)
    const children = chat.children
    const raw = chat.render(80)
    let enabled = true
    const detach = attachProjection(
      chat,
      () => enabled,
      () => [new Text('fold', 0, 0)],
    )
    expect(chat.render(80)).toEqual(new Text('fold', 0, 0).render(80))
    expect(chat.children).toBe(children)
    expect(chat.children).toEqual([native])
    enabled = false
    expect(chat.render(80)).toEqual(raw)
    detach()
    expect(Object.hasOwn(chat, 'render')).toBe(false)
    expect(chat.render(80)).toEqual(raw)
    detach()
  })

  test('delegates original render and mouse when projection returns native children', () => {
    const chat = new Container()
    let nativeClicked = false
    const native = {
      render: () => ['native'],
      invalidate() {},
      handleMouse: () => {
        nativeClicked = true
        return { handled: true as const }
      },
    }
    chat.addChild(native)
    const detach = attachProjection(
      chat,
      () => true,
      () => chat.children,
    )
    expect(chat.render(80)).toEqual(['native'])
    chat.handleMouse({
      type: 'click',
      button: 'left',
      x: 0,
      y: 0,
      screenX: 0,
      screenY: 0,
      width: 80,
      height: 1,
      shift: false,
      alt: false,
      ctrl: false,
    } as never)
    expect(nativeClicked).toBe(true)
    detach()
  })

  test('routes clicks through the same projected layout', () => {
    const chat = new Container()
    chat.addChild(new Text('one\ntwo\nthree', 0, 0))
    let clicked = false
    const detach = attachProjection(
      chat,
      () => true,
      () => [
        {
          render: () => ['fold'],
          invalidate() {},
          handleMouse: () => {
            clicked = true
            return { handled: true }
          },
        },
      ],
    )
    chat.render(80)
    chat.handleMouse({
      type: 'click',
      button: 'left',
      x: 0,
      y: 0,
      screenX: 0,
      screenY: 0,
      width: 80,
      height: 1,
      shift: false,
      alt: false,
      ctrl: false,
    } as never)
    expect(clicked).toBe(true)
    detach()
  })

  test('fails open atomically and reports one rendering failure', () => {
    const chat = new Container()
    chat.addChild(new Text('native failure stays visible', 0, 0))
    const raw = chat.render(80)
    let failures = 0
    const detach = attachProjection(
      chat,
      () => true,
      () => [
        {
          render() {
            throw new Error('broken presentation')
          },
          invalidate() {},
        },
      ],
      () => {
        failures++
      },
    )
    expect(chat.render(80)).toEqual(raw)
    expect(chat.render(80)).toEqual(raw)
    expect(failures).toBe(1)
    detach()
  })

  test('does not replace a later wrapper during teardown', () => {
    const chat = new Container()
    chat.addChild(new Text('native', 0, 0))
    const detach = attachProjection(
      chat,
      () => true,
      () => [new Text('fold', 0, 0)],
    )
    const ours = chat.render
    const later = (width: number) => ours.call(chat, width)
    chat.render = later
    detach()
    expect(chat.render).toBe(later)
    expect(chat.render(80)).toEqual(new Text('native', 0, 0).render(80))
  })

  test('recognizes only the supported document shape', () => {
    const tui = new Container()
    const document = new Container()
    const chat = new Container()
    document.addChild(new Container())
    document.addChild(new Container())
    document.addChild(chat)
    tui.addChild(document)
    expect(findTranscript(tui)).toBe(chat)
    expect(findTranscript(new Container())).toBeUndefined()
    document.addChild(new Container())
    expect(findTranscript(tui)).toBeUndefined()
  })
})
