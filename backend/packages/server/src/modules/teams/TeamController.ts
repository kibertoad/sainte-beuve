import {
  createTeamContract,
  deleteTeamContract,
  listTeamsContract,
  updateTeamContract,
} from '@sainte-beuve/contracts'
import { UnavailableError } from '@sainte-beuve/kernel'
import type { TeamActor } from '@sainte-beuve/reviewers'
import { buildHonoRoute } from '@toad-contracts/hono'
import { Hono } from 'hono'
import type { Input } from 'hono'
import type { AppContainer } from '../../container.js'
import type { AppEnv } from '../../http/env.js'
import { type AnyAppContext, principalOf, roleOf } from '../auth/principal.js'
import { viewerOf } from '../identity/ViewerService.js'
import { TeamService } from './TeamService.js'

/**
 * The team list. Every member reads it and may create a team they own; who
 * may change one is `decideTeamAction`'s call.
 */
export function teamController(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  buildHonoRoute(app, listTeamsContract, async (c) => {
    return c.json({ teams: await (await serviceFor(c)).list() }, 200)
  })

  buildHonoRoute(app, createTeamContract, async (c) => {
    return c.json(await (await serviceFor(c)).create(c.req.valid('json')), 201)
  })

  buildHonoRoute(app, updateTeamContract, async (c) => {
    const { teamId } = c.req.valid('param')
    return c.json(await (await serviceFor(c)).update(teamId, c.req.valid('json')), 200)
  })

  buildHonoRoute(app, deleteTeamContract, async (c) => {
    const { teamId } = c.req.valid('param')
    return c.json({ teams: await (await serviceFor(c)).delete(teamId) }, 200)
  })

  return app
}

async function serviceFor<E extends AppEnv, P extends string, I extends Input>(
  c: AnyAppContext<E, P, I>,
): Promise<TeamService> {
  const container: AppContainer = c.get('container')
  return new TeamService(container, await actorOf(c))
}

/**
 * The reviewer behind the request, and whether they administer the org. A key
 * is nobody, and an `open` deployment with no credential to name somebody by
 * has nobody either; both may still act as an admin when their role says so.
 */
async function actorOf<E extends AppEnv, P extends string, I extends Input>(
  c: AnyAppContext<E, P, I>,
): Promise<TeamActor> {
  const principal = principalOf(c)
  const admin = (await roleOf(c.get('container'), principal)) === 'admin'
  if (principal.kind === 'api_key') return { reviewerId: null, admin }
  try {
    return { reviewerId: (await viewerOf(c)).reviewer.id, admin }
  } catch (err) {
    if (err instanceof UnavailableError) return { reviewerId: null, admin }
    throw err
  }
}
