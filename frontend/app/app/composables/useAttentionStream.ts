import type { AttentionEvent, AttentionRequest } from '@sainte-beuve/contracts'

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
   * Where an event that arrives DURING a fetch is kept. The fetch answers from
   * a moment before that event was published, so assigning its list would drop
   * it; it is applied again on top.
   */
  let raced: AttentionEvent[] | null = null

  async function refresh(): Promise<void> {
    const queue: AttentionEvent[] = []
    raced = queue
    try {
      requests.value = (await api.listAttention()).requests
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
    const rest = requests.value.filter((entry) => entry.id !== event.request.id)
    requests.value = event.request.status === 'open' ? [event.request, ...rest] : rest
  }

  function connect(): void {
    if (typeof EventSource === 'undefined') return
    source = new EventSource(api.attentionStreamUrl)
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
    source.addEventListener('attention', (event) => {
      const received = JSON.parse((event as MessageEvent<string>).data) as AttentionEvent
      raced?.push(received)
      apply(received)
    })
    source.addEventListener('error', () => {
      // `EventSource` reconnects by itself, so this is a state to REPORT rather
      // than to repair: the list is still correct, it is just no longer live.
      live.value = false
    })
  }

  // Connected BEFORE the first fetch, not after: an ask raised between the two
  // is in the store the fetch is about to read, where an ask raised between a
  // fetch and a later subscribe would be in neither.
  onMounted(() => {
    connect()
    void refresh()
  })

  onBeforeUnmount(() => {
    source?.close()
    source = null
    live.value = false
    attached = false
  })

  return { requests, live, error, refresh }
}
