import * as v from 'valibot'
import { pullRequestStatusSchema } from './merging.js'
import { openPullRequestSchema } from './vcs.js'

// The shapes of the host reads a deployment keeps (see `HostSnapshotRepository`
// in the kernel). A kept read is decoded through its schema before it is served,
// so a snapshot written by an older build is a miss rather than a wrong answer.

const loginsSchema = v.array(v.string())

export const hostSnapshotSchemas = {
  openPullRequests: v.array(openPullRequestSchema),
  openReviews: v.array(
    v.object({ number: v.number(), reviewerLogins: loginsSchema, awaitingLogins: loginsSchema }),
  ),
  activity: v.object({
    reviewers: v.array(v.object({ login: v.string(), reviews: v.number() })),
    authors: v.array(v.object({ login: v.string(), pullRequests: v.number() })),
  }),
  /** `updatedAt` is the pull request's at the read, so a pull request that moved since is a miss. */
  pullRequestStatus: v.object({ updatedAt: v.number(), status: pullRequestStatusSchema }),
} as const

/** A decoder over one of the schemas above: the value, or null when it no longer fits. */
export function snapshotDecoder<TSchema extends v.GenericSchema>(
  schema: TSchema,
): (value: unknown) => v.InferOutput<TSchema> | null {
  return (value) => {
    const parsed = v.safeParse(schema, value)
    return parsed.success ? parsed.output : null
  }
}
