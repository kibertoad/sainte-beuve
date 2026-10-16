import {
  CAT_FACTORY_PERSONAL_ROUTE,
  type CatFactoryPersonalRoute,
  type PersonalRouteNeed,
  personalCatFactoryKey,
} from '@sainte-beuve/contracts'
import {
  type AiReviewGateway,
  ConflictError,
  type GatewayFactory,
  isDomainError,
} from '@sainte-beuve/kernel'
import type { AppContainer, CatFactoryActor } from '../container.js'
import { ViewerService } from '../modules/identity/ViewerService.js'
import {
  aiReviewGatewayFor,
  type CatFactoryOrgAccess,
  catFactoryAccess,
  openCredential,
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

/**
 * cat-factory's refusals of the person's own key, as what the person has to
 * supply: its `credential_required` reasons, and a workspace outside the key's
 * reach, which a key following its person's memberships meets only where the
 * person is not a member.
 */
const PERSONAL_KEY_NEEDS: Record<string, PersonalRouteNeed> = {
  password_required: 'password',
  wrong_password: 'wrong_password',
  no_subscription: 'subscription',
  subscription_expired: 'subscription_expired',
  workspace_not_found: 'workspace',
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
  workspace:
    'Your cat-factory key does not reach the workspace this repository is linked in. Join that ' +
    'workspace in cat-factory, or mint a key that follows your memberships, then try again',
  retry:
    'AI reviews here run on a personal model subscription. Your key is stored, so try again to ' +
    'run this on it',
}

function personalRouteRefusal(need: PersonalRouteNeed, vendor: string | null): ConflictError {
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
async function actingReviewerId(container: AppContainer, actor: CatFactoryActor): Promise<string> {
  return (await new ViewerService(container, actor.principal).current()).reviewer.id
}

/**
 * The AI reviewer for a request that files or answers a review.
 *
 * The credential is opened only when a call is made (`open`, `act`), so every
 * check a service makes in front of the call refuses first: nobody is asked for
 * a password to be told the pull request is not theirs.
 */
export interface ActingAiReview {
  /** Whether calls go through the acting person's own key and password. */
  personal: boolean
  /** Whether the org is known to need the personal route, whoever is acting. */
  personalRouteRequired: boolean
  /** The gateway on the acting credential. Refuses, without asking cat-factory, when the person's key or password is missing. */
  open(): Promise<AiReviewGateway>
  /** One call on the acting credential, learning from how cat-factory refuses it. */
  act<T>(call: (gateway: AiReviewGateway) => Promise<T>): Promise<T>
}

/**
 * The org's key, unless the org is known to need the personal route and the
 * request acts for a person, when it is that person's own key and password.
 * Null when cat-factory is not configured.
 */
export async function resolveActingAiReview(
  container: AppContainer,
): Promise<ActingAiReview | null> {
  const { catFactoryActor: actor, gateways } = container
  const [access, required] = await Promise.all([
    catFactoryAccess(container),
    personalRouteRequired(container),
  ])
  if (access === null || gateways === null) return null
  const personal = actor !== null && required
  let opened: Promise<AiReviewGateway> | null = null
  const acting: ActingAiReview = {
    personal,
    personalRouteRequired: required,
    open: () => {
      opened ??= personal
        ? personalGateway(container, { gateways, access, actor })
        : Promise.resolve(aiReviewGatewayFor(gateways, access, null))
      return opened
    },
    act: async (call) => {
      const gateway = await acting.open()
      try {
        return await call(gateway)
      } catch (err) {
        throw await lesson(container, acting, err)
      }
    },
  }
  return acting
}

async function personalGateway(
  container: AppContainer,
  acting: { gateways: GatewayFactory; access: CatFactoryOrgAccess; actor: CatFactoryActor },
): Promise<AiReviewGateway> {
  const { gateways, access, actor } = acting
  const reviewerId = await actingReviewerId(container, actor)
  const apiKey = await openCredential(container, personalCatFactoryKey(reviewerId))
  if (apiKey === null) throw personalRouteRefusal('personal_key', null)
  if (actor.personalPassword === null) throw personalRouteRefusal('password', null)
  return aiReviewGatewayFor(gateways, { config: access.config, apiKey }, actor.personalPassword)
}

/**
 * What cat-factory's refusal of an acting call teaches. The org's key refused
 * for a model only a person may run marks the org as needing the personal
 * route, and the person is told what to supply; a personal-credential refusal
 * on the person's key becomes the same refusal. Anything else passes.
 */
async function lesson(
  container: AppContainer,
  acting: ActingAiReview,
  err: unknown,
): Promise<unknown> {
  const { reason, vendor } = upstreamReasonOf(err)
  if (reason === null) return err
  const need = PERSONAL_KEY_NEEDS[reason]
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
