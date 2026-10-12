import type { ExternalRepository } from '@sainte-beuve/contracts'

/** An external repository entry before it is bound to the source it came from. */
export type ExternalRepositoryEntry = Omit<ExternalRepository, 'source'>

/**
 * Where a repository sync writes: the entries one source lists, and how far
 * along its change feed they have been applied. A source that also lists other
 * things (users, workspaces) keeps none of them here.
 */
export interface RepositoryDirectoryStore {
  getCursor(): Promise<number | null>
  setCursor(seq: number): Promise<void>
  /** Write one entry unless the store holds a strictly newer `seq` for its key. */
  apply(entry: ExternalRepositoryEntry): Promise<void>
  /** The keys of every entry whose link is still there. */
  liveKeys(): Promise<string[]>
}

/** What one sync call did. */
export interface DirectorySyncReport {
  /** The feed position the mirror has applied through. */
  cursor: number
  /** Whether it walked the snapshots rather than only following the feed. */
  reconciled: boolean
}

/** A pushed delivery, verified or not. A refusal carries the verifier's reason. */
export type DirectoryDeliveryOutcome =
  | { ok: true; event: string; sync: DirectorySyncReport }
  | { ok: false; reason: string }

/**
 * An external system's list of repositories, followed to keep the org's
 * projects in step with it. cat-factory's account directory is one.
 */
export interface RepositoryDirectoryGateway {
  /** Follow the change feed from the stored cursor, reconciling when there is none. */
  catchUp(store: RepositoryDirectoryStore): Promise<DirectorySyncReport>
  /** Walk the snapshots, remove what they no longer hold, then follow the feed. */
  reconcile(store: RepositoryDirectoryStore): Promise<DirectorySyncReport>
  /** Verify a pushed delivery over its raw body, apply it, then catch up. */
  receive(
    store: RepositoryDirectoryStore,
    delivery: { headers: Headers; rawBody: string; secret: string },
  ): Promise<DirectoryDeliveryOutcome>
  /** Ask the source to push changes to `url`, signed with `secret`. Enrolling twice updates. */
  registerWebhook(input: { webhookId: string; url: string; secret: string }): Promise<void>
  /** Remove a webhook. Removing one that is not there succeeds. */
  removeWebhook(webhookId: string): Promise<void>
}
