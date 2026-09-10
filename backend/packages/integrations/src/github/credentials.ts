import type { GitHubAppAuth } from './GitHubAppAuth.js'

/**
 * Where `GitHubVcsGateway` gets the token for one call.
 *
 * The gateway takes a SOURCE rather than a token because the two credential
 * shapes differ in when they are known: a personal access token and a sign-in
 * token are fixed for the life of the gateway, while an App installation token
 * depends on which repository the call is for and expires under it. A gateway
 * built around a string would have had to be rebuilt per repository, which is
 * how a cached key import and a cached installation lookup get thrown away.
 */
export interface GitHubTokenSource {
  /** The token to authenticate a call about `owner/repo` with. */
  tokenFor(owner: string, repo: string): Promise<string>
  /**
   * Whether this credential belongs to a person, which decides whether asking
   * GitHub who it is makes sense. An App installation token has no user behind
   * it, and `GET /user` under one answers 403.
   */
  readonly hasUser: boolean
}

/** A fixed token: a personal access token, or the one a sign-in produced. */
export function staticTokenSource(token: string): GitHubTokenSource {
  return {
    hasUser: true,
    tokenFor: () => Promise.resolve(token),
  }
}

/** Installation tokens minted per repository by the deployment's GitHub App. */
export function appTokenSource(auth: GitHubAppAuth): GitHubTokenSource {
  return {
    hasUser: false,
    tokenFor: (owner, repo) => auth.tokenForRepo(owner, repo),
  }
}
