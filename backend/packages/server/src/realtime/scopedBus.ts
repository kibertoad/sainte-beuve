import type { AttentionBus, ScopedAttentionBus } from '@sainte-beuve/kernel'

/**
 * The process-wide bus, bound to one org.
 *
 * The bus is the one thing on the container that `PersistenceProvider.forOrg`
 * has no equivalent for: it has to be ONE object per process (a Worker rebuilds
 * its container per request, so a bus built with it would have one subscriber
 * and no publisher), which means it cannot be constructed per tenancy the way
 * the repositories are. This closes the same gap from the other side — the org
 * is a parameter of the BUS and never of its callers, so `withOrg` hands the
 * services a `publish`/`subscribe` pair that can only reach one tenancy.
 *
 * Without it the leak is quiet and complete: `reaches` filters a live event on
 * the audience rule, which knows about skills and teams and nothing about orgs,
 * and an ask with no required skills and no same-team gate concerns ANY
 * available reviewer. One process serving two tenancies would push every ask in
 * the first onto the open streams of the second.
 */
export function scopedBus(bus: AttentionBus, orgId: string): ScopedAttentionBus {
  return {
    publish: (event) => bus.publish(orgId, event),
    subscribe: (listener, onClose) => bus.subscribe(orgId, listener, onClose),
  }
}
