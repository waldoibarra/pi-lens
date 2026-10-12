import { ScrollView } from '@earendil-works/pi-tui'

const corrections = new WeakMap<ScrollView, () => void>()

/** Pi 1.1 re-enables following when an interior inspection offset clamps to the end. */
function guardCollapse(scrollView: ScrollView): void {
  if (corrections.has(scrollView)) return
  const original = scrollView.updateLayout
  // Do not wrap another extension's instance override or an unrecognized host method.
  if (original !== ScrollView.prototype.updateLayout) return
  const corrected: ScrollView['updateLayout'] = function (this: ScrollView, ...args) {
    const wasFollowing = this.isFollowingEnd
    original.apply(this, args)
    if (!wasFollowing && this.isFollowingEnd) this.scrollTo(this.scrollTop, { disableFollow: true })
  }
  scrollView.updateLayout = corrected
  corrections.set(scrollView, () => {
    if (scrollView.updateLayout === corrected) Reflect.deleteProperty(scrollView, 'updateLayout')
    corrections.delete(scrollView)
  })
}

export function releaseViewport(tui: unknown): void {
  try {
    if (!isObject(tui) || typeof tui.getPrimaryScrollView !== 'function') return
    const scrollView = tui.getPrimaryScrollView()
    if (scrollView instanceof ScrollView) corrections.get(scrollView)?.()
  } catch {
    /* Unsupported hosts retain native behavior. */
  }
}

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null
}

export function preserveViewport(tui: unknown): boolean {
  try {
    if (!isObject(tui) || tui.mode !== 'fullscreen') return false

    const getPrimaryScrollView = tui.getPrimaryScrollView
    if (typeof getPrimaryScrollView !== 'function') return false

    const scrollView = getPrimaryScrollView.call(tui)
    if (!isObject(scrollView)) return false

    const { scrollTop } = scrollView
    if (typeof scrollTop !== 'number' || !Number.isFinite(scrollTop)) return false

    const scrollTo = scrollView.scrollTo
    if (typeof scrollTo !== 'function') return false

    if (scrollView instanceof ScrollView) guardCollapse(scrollView)
    scrollTo.call(scrollView, scrollTop, { disableFollow: true })
    return true
  } catch {
    return false
  }
}
