import type { GuidedReviewSessionView } from '@sainte-beuve/contracts'
import { guidedReviewStreamEventSchema } from '@sainte-beuve/contracts'
import * as v from 'valibot'

/** How long before the first reconnect, matching the server's `retry` for a stream that ended on schedule. */
const RECONNECT_MS = 3_000

/** The ceiling repeated failures back off to. */
const RECONNECT_MAX_MS = 60_000

/** A stream that lasted this long was working, so the next drop starts over at the floor. */
const HEALTHY_MS = 30_000

export interface GuidedReviewStreamHandlers {
  state: (view: GuidedReviewSessionView) => void
  deleted: () => void
}

/**
 * One guided review, kept live over its stream.
 *
 * `live` is what the page decides to poll on: while it is false the stream is
 * down or reconnecting, and the page re-reads instead. cat-factory caps every
 * stream, so a drop is ordinary; a drop that comes back quickly after a short
 * life backs off, the way the attention inbox does.
 */
export function useGuidedReviewStream(
  sessionId: () => string | null,
  handlers: GuidedReviewStreamHandlers,
) {
  const api = useSainteBeuveApi()
  const live = ref(false)
  let source: EventSource | null = null
  let reconnect: ReturnType<typeof setTimeout> | null = null
  let backoffMs = RECONNECT_MS
  let openedAt = 0
  let unmounted = false

  function read(event: Event): void {
    // Through the contract's schema: a stream does not pass `sendByApiContract`,
    // and a frame it does not describe is dropped rather than applied.
    const parsed = v.safeParse(
      guidedReviewStreamEventSchema,
      JSON.parse((event as MessageEvent<string>).data),
    )
    if (!parsed.success) return
    if (parsed.output.kind === 'state') {
      handlers.state(parsed.output.view)
      return
    }
    // Nothing left to follow: stop here rather than reconnect into a 404.
    close()
    handlers.deleted()
  }

  function connect(): void {
    const id = sessionId()
    if (unmounted || id === null || typeof EventSource === 'undefined') return
    reconnect = null
    openedAt = Date.now()
    source = new EventSource(api.guidedReviewStreamUrl(id), { withCredentials: true })
    source.addEventListener('open', () => {
      live.value = true
    })
    source.addEventListener('guidedReview', read)
    source.addEventListener('error', dropped)
  }

  function dropped(): void {
    live.value = false
    source?.close()
    source = null
    if (reconnect !== null) return
    const wait = Date.now() - openedAt >= HEALTHY_MS ? RECONNECT_MS : backoffMs
    backoffMs = Math.min(wait * 2, RECONNECT_MAX_MS)
    reconnect = setTimeout(connect, wait)
  }

  function close(): void {
    if (reconnect !== null) clearTimeout(reconnect)
    reconnect = null
    source?.close()
    source = null
    live.value = false
  }

  // A different session (or the first one) is a different stream.
  watch(
    sessionId,
    () => {
      close()
      backoffMs = RECONNECT_MS
      connect()
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    unmounted = true
    close()
  })

  return { live }
}
