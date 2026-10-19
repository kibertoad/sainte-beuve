import type { AttentionRequest, CreateAttentionRequest, Reviewer } from '@sainte-beuve/contracts'
import { distinctAsSpelled } from '@sainte-beuve/reviewers'
import type { AppContainer } from '../../container.js'
import { addressAsk } from './recipients.js'

/** A new ask as it is about to be written, and the people it names. */
export interface DraftAsk {
  request: AttentionRequest
  named: Reviewer[]
}

export async function draftAsk(
  container: AppContainer,
  requester: Reviewer,
  input: CreateAttentionRequest,
): Promise<DraftAsk> {
  const { clock, ids } = container
  const { named, wanted } = await addressAsk(container, requester, input)
  const recipients = named.map((reviewer) => ({
    reviewerId: reviewer.id,
    displayName: reviewer.displayName,
  }))
  const now = clock.now()
  const request: AttentionRequest = {
    id: ids.next(),
    pullRequest: input.pullRequest,
    title: input.title,
    requestedById: requester.id,
    requestedByName: requester.displayName,
    recipients,
    requiredSkills: distinctAsSpelled(wanted.skills),
    domains: distinctAsSpelled(wanted.domains),
    sameTeamOnly: input.sameTeamOnly,
    // The requester's team is captured HERE rather than read at delivery
    // time, so somebody changing team does not silently re-address an ask
    // that is already out.
    team: requester.team,
    neededCommitments: input.neededCommitments,
    commitments: [],
    note: input.note,
    status: 'open',
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
    chatDeliveries: [],
    declines: [],
    // Asking on means asking the next named person, which an ask sent by
    // fit has no use for: it already reaches everybody who matches.
    keepAsking: input.keepAsking && recipients.length > 0,
    people: input.people,
  }
  return { request, named }
}
