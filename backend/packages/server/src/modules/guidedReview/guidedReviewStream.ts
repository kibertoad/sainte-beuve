import type { GuidedReviewStreamEvent } from '@sainte-beuve/contracts'
import { getErrorMessage, type Logger } from '@sainte-beuve/kernel'
import { RETRY_MS, sseStream } from '../../realtime/sse.js'
import type { GuidedReviewWatch } from './GuidedReviewService.js'

/**
 * A guided review's stream: the view it opened on, then cat-factory's frames.
 *
 * cat-factory ends its own stream on a cap (`timeout`), which is a reconnect on
 * schedule and is told to come back at once. Anything else that ends it, the
 * session deleted or cat-factory unreachable mid-stream, is told to wait the
 * longer interval; the page polls meanwhile.
 */
export function guidedReviewStream(watched: GuidedReviewWatch, logger: Logger): Response {
  return sseStream({
    eventName: 'guidedReview',
    subscribe: (emit, end) => {
      const abort = new AbortController()
      emit({ kind: 'state', view: watched.initial } satisfies GuidedReviewStreamEvent)
      void relay(watched, abort.signal, emit)
        .then((reason) => end(reason === 'timeout' ? RETRY_MS : undefined))
        .catch((err: unknown) => {
          if (abort.signal.aborted) return
          logger.warn(
            { err },
            `a guided review stream from cat-factory broke: ${getErrorMessage(err)}`,
          )
          end()
        })
      return () => abort.abort()
    },
  })
}

async function relay(
  watched: GuidedReviewWatch,
  signal: AbortSignal,
  emit: (payload: GuidedReviewStreamEvent) => void,
): Promise<'timeout' | 'ended'> {
  for await (const event of watched.events(signal)) {
    if (event.kind === 'timeout') return 'timeout'
    emit(event)
  }
  return 'ended'
}
