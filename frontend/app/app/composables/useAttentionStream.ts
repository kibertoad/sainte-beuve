import type { AttentionEvent, AttentionRequest } from '@sainte-beuve/contracts'
import { attentionEventSchema } from '@sainte-beuve/contracts'
import * as v from 'valibot'

/**
 * The attention inbox, kept live.
 *
 * TWO paths, and neither is a fallback for the other. The REST fetch is what a
 * page opened an hour after the ask was raised sees; the stream is what a page
 * that was already open sees within a second. The stream carries the same
 * payload as the fetch, so the two readers are looking at the same product.
 *
 * A request LEAVES the list when it is resolved or cancelled, which is the
 * behaviour the whole feature turns on: an ask that stayed up after somebody
 * else took it would teach the team to ignore the next one.
 */

/** How long before the first reconnect: the same wait the server's `retry` names. */
const RECONNECT_MS = 3_000

/** The ceiling repeated failures back off to. */
const RECONNECT_MAX_MS = 60_000

/** A stream that lasted this long was working, so the next drop starts over at the floor. */
const HEALTHY_MS = 30_000

export function useAttentionStream() {
  const api = useSainteBeuveApi()
  const requests = ref<AttentionRequest[]>([])
  /** Whether the live half is attached. False is not an error: the fetch still works. */
  const live = ref(false)
  const error = ref<string | null>(null)
  let source: EventSource | null = null
  /** Whether the stream has been attached before, so an `open` is a RECONNECT. */
  let attached = false
  /**
   * Which version of each request has been applied, so two events that raced
   * each other on the way here land in the order they were WRITTEN. See
   * `createAttentionLedger`.
   */
  const ledger = createAttentionLedger()
  /**
   * Where an event that arrives DURING a fetch is kept. The fetch answers from
   * a moment before that event was published, so assigning its list would drop
   * it; it is applied again on top.
   */
  let raced: AttentionEvent[] | null = null
  /** The reconnect this page is waiting on, and how long the next one waits. */
  let reconnect: ReturnType<typeof setTimeout> | null = null
  let backoffMs = RECONNECT_MS
  let openedAt = 0
  /** Set when the page goes away, so a pending reconnect does not raise the dead. */
  let unmounted = false

  async function refresh(): Promise<void> {
    const queue: AttentionEvent[] = []
    raced = queue
    try {
      const fetched = (await api.listAttention()).requests
      // The fetch is the authority for everything it is not already BEHIND on.
      // A snapshot taken before a resolution this page has already watched
      // arrive would otherwise put the answered ask back, and no later event
      // would take it away again.
      requests.value = fetched.filter((request) => !ledger.isStale(request))
      for (const request of fetched) ledger.remember(request)
      for (const event of queue) apply(event)
      error.value = null
    } catch (err) {
      // A deployment that cannot say who is looking answers 503 here, which is
      // a configuration answer rather than a fault to swallow.
      error.value = apiErrorMessage(err)
      requests.value = []
    } finally {
      raced = null
    }
  }

  function apply(event: AttentionEvent): void {
    const incoming = event.request
    if (ledger.isStale(incoming)) return
    ledger.remember(incoming)
    const rest = requests.value.filter((entry) => entry.id !== incoming.id)
    requests.value = incoming.status === 'open' ? [incoming, ...rest] : rest
  }

  function read(event: Event): void {
    // Through the contract's schema, like every other body this client reads.
    //
    // Nothing else checks this one. `buildHonoRoute` validates requests and never
    // responses, and a stream does not go through `sendByApiContract`, so an event
    // missing its `request` would reach `apply` and throw a TypeError from inside
    // a listener, where `useApiAction` cannot catch it and the page has no way to
    // report it. A payload the contract does not describe is a backend fault, so
    // it is dropped and reported rather than applied.
    const parsed = v.safeParse(
      attentionEventSchema,
      JSON.parse((event as MessageEvent<string>).data),
    )
    if (!parsed.success) {
      error.value = 'The attention stream sent an event this deployment cannot read'
      return
    }
    raced?.push(parsed.output)
    apply(parsed.output)
  }

  function connect(): void {
    if (unmounted || typeof EventSource === 'undefined') return
    reconnect = null
    openedAt = Date.now()
    // `withCredentials`, so the stream carries the session cookie the fetches
    // carry. Without it a signed-in page would read its inbox as itself and
    // stream somebody else's, which is worse than not streaming at all.
    //
    // Like the fetches, this needs an origin the deployment NAMED: a credentialed
    // `EventSource` refuses a `*` answer, so on a deployment that named nothing
    // this error-loops rather than degrading. Nothing here can repair that, and
    // nothing should pretend to — the fetches on the same page have already
    // failed, and the Access card says what to configure.
    source = new EventSource(api.attentionStreamUrl, { withCredentials: true })
    source.addEventListener('open', () => {
      live.value = true
      // Every event published while the connection was down went to a
      // subscriber the backend had already dropped, so a reconnect starts from
      // a list that is missing them. Reading 'live' beside a stale inbox is
      // worse than the honest 'refresh to update' the badge showed a second
      // ago, so the list is fetched again each time the stream comes back.
      if (attached) void refresh()
      attached = true
    })
    source.addEventListener('attention', read)
    source.addEventListener('error', dropped)
  }

  /**
   * The stream went away: report it, and come back on OUR schedule.
   *
   * `EventSource` reconnects by itself, on a fixed interval and with no backoff
   * of its own, and the reconnect is not free — the page refetches its inbox
   * every time the stream comes back, so a deployment whose fan-out is
   * unreachable would answer a stream, close it and be asked again, per open
   * page, for as long as it is down. Closing the source here is what takes that
   * decision off the browser; a connection that lasted starts the next one back
   * at the floor, so the cost of a fault falls on the fault rather than on the
   * ordinary reconnect a laptop waking up is.
   */
  function dropped(): void {
    live.value = false
    source?.close()
    source = null
    if (reconnect !== null) return
    const wait = Date.now() - openedAt >= HEALTHY_MS ? RECONNECT_MS : backoffMs
    backoffMs = Math.min(wait * 2, RECONNECT_MAX_MS)
    reconnect = setTimeout(connect, wait)
  }

  // Connected BEFORE the first fetch, not after: an ask raised between the two
  // is in the store the fetch is about to read, where an ask raised between a
  // fetch and a later subscribe would be in neither.
  onMounted(() => {
    connect()
    void refresh()
  })

  onBeforeUnmount(() => {
    unmounted = true
    if (reconnect !== null) clearTimeout(reconnect)
    reconnect = null
    source?.close()
    source = null
    live.value = false
    attached = false
  })

  return { requests, live, error, refresh }
}
