import {
  askSuggestedReviewersContract,
  listMyPullRequestsContract,
  mergeMyPullRequestContract,
  postMergeCommentContract,
  resolveConflictsContract,
  suggestReviewersContract,
} from '@sainte-beuve/contracts'
import { buildHonoRoute } from '@toad-contracts/hono'
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.js'
import { principalOf } from '../auth/principal.js'
import { MergeService } from './MergeService.js'
import { MyPullRequestsService } from './MyPullRequestsService.js'
import { ReviewerSuggestionService } from './ReviewerSuggestionService.js'

/**
 * My PRs: the viewer's own open pull requests, merging them, resolving their
 * conflicts, and asking reviewers for them.
 */
export function myPullRequestsController(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  buildHonoRoute(app, listMyPullRequestsContract, async (c) => {
    const service = new MyPullRequestsService(c.get('container'), principalOf(c))
    return c.json(await service.list(c.req.valid('query')), 200)
  })

  buildHonoRoute(app, mergeMyPullRequestContract, async (c) => {
    const service = new MergeService(c.get('container'), principalOf(c))
    return c.json(await service.merge(c.req.valid('json')), 200)
  })

  buildHonoRoute(app, postMergeCommentContract, async (c) => {
    const service = new MergeService(c.get('container'), principalOf(c))
    return c.json(await service.postComment(c.req.valid('json')), 200)
  })

  buildHonoRoute(app, resolveConflictsContract, async (c) => {
    const service = new MergeService(c.get('container'), principalOf(c))
    return c.json(await service.resolveConflicts(c.req.valid('json')), 200)
  })

  buildHonoRoute(app, suggestReviewersContract, async (c) => {
    const service = new ReviewerSuggestionService(c.get('container'), principalOf(c))
    return c.json(await service.suggest(c.req.valid('json')), 200)
  })

  buildHonoRoute(app, askSuggestedReviewersContract, async (c) => {
    const service = new ReviewerSuggestionService(c.get('container'), principalOf(c))
    return c.json(await service.ask(c.req.valid('json')), 200)
  })

  return app
}
