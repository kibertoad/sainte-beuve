/**
 * A deadline on every call to a host we do not control.
 *
 * Here rather than beside one adapter because four of them need the same rule:
 * GitHub, GitLab, Slack and cat-factory are all reached from paths that have
 * somebody waiting at the other end, and none of them answers to us. A `fetch`
 * with no `signal` waits as long as the connection stays open, which on a
 * stalled upstream is until the runtime gives up on the whole invocation.
 *
 * What that costs is not one slow call. The reminder tick awaits a chat post per
 * nudge inside one cron invocation, and the workspace read fans a project out
 * per host with `Promise.all`: one connection that is accepted and never
 * answered holds the pass — or the person's screen — open behind it. Given up
 * on, the failure is an `UpstreamFailedError` the caller already knows how to
 * report, and the next reminder or the next project goes ahead.
 *
 * Nothing here reaches a network itself: it wraps the `fetch` an adapter was
 * given, so a suite that passes a stub still gets its stub.
 */

/**
 * How long any one call to an upstream host may take before it is abandoned.
 *
 * Generous enough that nothing merely busy is cut off — every endpoint these
 * adapters touch is a read or a post that answers in milliseconds, and the two
 * long-running things in the system (an AI review, a reminder ladder) are
 * asynchronous by construction, so no call is waiting on work to finish.
 */
export const UPSTREAM_TIMEOUT_MS = 20_000

/**
 * The same `fetch`, with a deadline on every request.
 *
 * Wrapped at the transport rather than at each call site, so a path that grows a
 * second request gets it without anybody remembering to. A signal the CALLER
 * supplies is kept and combined rather than replaced: their cancellation is not
 * ours to drop.
 */
export function withDeadline(
  impl: typeof globalThis.fetch = globalThis.fetch,
  timeoutMs: number = UPSTREAM_TIMEOUT_MS,
): typeof globalThis.fetch {
  return (input, init) => {
    const deadline = AbortSignal.timeout(timeoutMs)
    const caller = init?.signal
    return impl(input, {
      ...init,
      signal: caller == null ? deadline : AbortSignal.any([caller, deadline]),
    })
  }
}
