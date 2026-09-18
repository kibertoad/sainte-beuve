/**
 * The small runtime seams. Injected rather than imported so the domain packages
 * stay pure: a test drives `Clock` and `IdGenerator` instead of freezing timers or
 * matching a uuid with a regex, and the Worker and Node facades supply the same
 * two without either package knowing which runtime it is on.
 */

export interface Clock {
  now(): number
}

export interface IdGenerator {
  next(): string
}

export interface Logger {
  debug(obj: object, msg?: string): void
  info(obj: object, msg?: string): void
  warn(obj: object, msg?: string): void
  error(obj: object, msg?: string): void
}

export const systemClock: Clock = {
  now: () => Date.now(),
}

/** `crypto.randomUUID` is present in workerd, Node 24 and every browser we target. */
export const uuidGenerator: IdGenerator = {
  next: () => crypto.randomUUID(),
}

/**
 * Keep work alive past the response that started it.
 *
 * The seam exists because the two runtimes disagree about what happens to a
 * promise nobody awaited: a Node process runs it to completion, and a Worker
 * may cancel every outstanding I/O the moment the response is returned. A
 * publish that fans an event out over the network is exactly that shape — it
 * must not be awaited, because it happens after a write that already succeeded
 * and cannot be allowed to fail it — so the facade hands down the runtime's own
 * `waitUntil`, and a runtime that has none supplies a swallow.
 */
export type Deferral = (work: Promise<unknown>) => void
