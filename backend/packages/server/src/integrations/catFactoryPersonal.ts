import {
  CAT_FACTORY_PERSONAL_ROUTE,
  type CatFactoryPersonalRoute,
  type PersonalRouteNeed,
  personalCatFactoryKey,
} from '@sainte-beuve/contracts'
import { type AiReviewGateway, ConflictError, isDomainError } from '@sainte-beuve/kernel'
import type { AppContainer, CatFactoryActor } from '../container.js'
import { ViewerService } from '../modules/identity/ViewerService.js'
import {
  type CatFactoryOrgAccess,
  catFactoryAccess,
  type CredentialSource,
  openCredential,
  type Resolved,
  resolveAiReview,
} from './resolve.js'

/**
 * Whether this org's AI reviews have to run on the acting person's own model
 * subscription, as cat-factory's refusals taught it. A config row of its own,
 * so saving the cat-factory settings (a new pipeline, a new instance) is what
 * forgets it: see `forgetPersonalRoute`.
 */
const ROUTING_ID = 'cat-factory-routing'

/** cat-factory's reasons for refusing the org's key a model only a person may run. */
const ORG_KEY_REFUSALS = new Set(['individual_model_unsupported', 'providers_unconfigured'])

/** cat-factory's `credential_required` reasons, as what the person has to supply. */
const CREDENTIAL_NEEDS: Record<string, PersonalRouteNeed> = {
  password_required: 'password',
  wrong_password: 'wrong_password',
  no_subscription: 'subscription',
  subscription_expired: 'subscription_expired',
}

const NEED_MESSAGES: Record<PersonalRouteNeed, string> = {
  personal_key:
    'AI reviews here run on a personal model subscription, which cat-factory opens only through ' +
    'your own key. Mint one in cat-factory with "Runs as" set to yourself, and store it on the ' +
    'Configuration screen',
  password: 'Enter your cat-factory personal password to run this on your subscription',
  wrong_password: 'That personal password did not open your cat-factory subscription',
  subscription:
    'cat-factory holds no personal subscription for you. Connect one in cat-factory, then try again',
  subscription_expired:
    'Your personal subscription in cat-factory has expired. Renew it there, then try again',
  retry:
    'AI reviews here run on a personal model subscription. Your key is stored, so try again to ' +
    'run this on it',
}

export function personalRouteRefusal(
  need: PersonalRouteNeed,
  vendor: string | null,
): ConflictError {
  const details: CatFactoryPersonalRoute = { reason: CAT_FACTORY_PERSONAL_ROUTE, need, vendor }
  return new ConflictError(NEED_MESSAGES[need], details)
}

export async function personalRouteRequired(container: AppContainer): Promise<boolean> {
  const row = await container.repositories.integrationConfigs.get(ROUTING_ID)
  return row?.values.personalRoute === 'required'
}

export async function forgetPersonalRoute(container: AppContainer): Promise<void> {
  await container.repositories.integrationConfigs.delete(ROUTING_ID)
}

/** Every person's stored cat-factory key, for an org that moved to another instance. */
export async function forgetPersonalKeys(container: AppContainer): Promise<void> {
  const { integrationTokens } = container.repositories
  const rows = await integrationTokens.list()
  const personal = rows.filter((row) => row.integrationId.startsWith(personalCatFactoryKey('')))
  await Promise.all(personal.map((row) => integrationTokens.delete(row.integrationId)))
}

/** The reviewer a request acts for. Resolved only once the personal route is needed. */
export async function actingReviewerId(
  container: AppContainer,
  actor: CatFactoryActor,
): Promise<string> {
  return (await new ViewerService(container, actor.principal).current()).reviewer.id
}

/** An AI reviewer acting for the request's person, and whether it is their key. */
export interface ActingAiReview extends Resolved<AiReviewGateway, CredentialSource> {
  personal: boolean
}

/**
 * The AI reviewer for a request that files or answers a review. The org's key,
 * unless the org is known to need the personal route and the request acts for
 * a person, when it is that person's own key and password. Refused here,
 * without asking cat-factory, when either is missing: cat-factory would only
 * refuse it too.
 */
export async function resolveActingAiReview(
  container: AppContainer,
): Promise<ActingAiReview | null> {
  const actor = container.catFactoryActor
  const [access, required] = await Promise.all([
    catFactoryAccess(container),
    actor === null ? false : personalRouteRequired(container),
  ])
  if (access === null || container.gateways === null) return null
  const personal = actor !== null && required
  const acting = personal ? await personalAccess(container, access, actor) : access
  const password = personal ? actor.personalPassword : null
  const resolved = await resolveAiReview(container, Promise.resolve(acting), password)
  return resolved === null ? null : { ...resolved, personal }
}

async function personalAccess(
  container: AppContainer,
  access: CatFactoryOrgAccess,
  actor: CatFactoryActor,
): Promise<CatFactoryOrgAccess> {
  const reviewerId = await actingReviewerId(container, actor)
  const apiKey = await openCredential(container, personalCatFactoryKey(reviewerId))
  if (apiKey === null) throw personalRouteRefusal('personal_key', null)
  if (actor.personalPassword === null) throw personalRouteRefusal('password', null)
  return { config: access.config, apiKey }
}

/**
 * Run one acting call, and learn from how cat-factory refuses it. The org's key
 * refused for a model only a person may run marks the org as needing the
 * personal route, and the person is told what to supply; a personal-credential
 * refusal on the person's key becomes the same refusal. Anything else passes.
 */
export async function learningPersonalRoute<T>(
  container: AppContainer,
  acting: ActingAiReview,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call()
  } catch (err) {
    throw await lesson(container, acting, err)
  }
}

async function lesson(
  container: AppContainer,
  acting: ActingAiReview,
  err: unknown,
): Promise<unknown> {
  const { reason, vendor } = upstreamReasonOf(err)
  if (reason === null) return err
  const need = CREDENTIAL_NEEDS[reason]
  if (acting.personal && need !== undefined) return personalRouteRefusal(need, vendor)
  const actor = container.catFactoryActor
  if (acting.personal || actor === null || !ORG_KEY_REFUSALS.has(reason)) return err
  await container.repositories.integrationConfigs.put({
    integrationId: ROUTING_ID,
    values: { personalRoute: 'required' },
    updatedAt: container.clock.now(),
  })
  const reviewerId = await actingReviewerId(container, actor)
  const stored = await container.repositories.integrationTokens.get(
    personalCatFactoryKey(reviewerId),
  )
  if (stored === null) return personalRouteRefusal('personal_key', vendor)
  return personalRouteRefusal(actor.personalPassword === null ? 'password' : 'retry', vendor)
}

function upstreamReasonOf(err: unknown): { reason: string | null; vendor: string | null } {
  if (!isDomainError(err)) return { reason: null, vendor: null }
  const details = err.details as { upstream?: unknown; reason?: unknown; vendor?: unknown } | null
  if (details?.upstream !== 'cat-factory' || typeof details.reason !== 'string') {
    return { reason: null, vendor: null }
  }
  return {
    reason: details.reason,
    vendor: typeof details.vendor === 'string' ? details.vendor : null,
  }
}
