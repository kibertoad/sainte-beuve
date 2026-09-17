import type { AuthState, Principal } from '@sainte-beuve/contracts'
import type { AppContainer } from '../../container.js'
import { ConnectionsService } from '../connections/ConnectionsService.js'
import { ViewerService } from '../identity/ViewerService.js'
import { OrgService } from '../orgs/OrgService.js'
import { roleOf, type RequestPrincipal } from './principal.js'
import { sessionOnTheWire } from './SessionService.js'

/**
 * What a screen asks before it renders anything: who I am, whether this
 * deployment cares, and where I could sign in.
 *
 * It answers the ANONYMOUS case rather than refusing it, in both modes. A screen
 * that had to be signed in to find out that it is not signed in has nowhere to
 * start, which is why this route is the one exemption from the guard (see
 * `principal.ts`).
 */
export class AuthService {
  constructor(private readonly container: AppContainer) {}

  async state(principal: RequestPrincipal): Promise<AuthState> {
    // The org and the role beside the principal, because a screen needs both
    // before it can draw anything: which board it is looking at, and whether to
    // offer the Configuration screen at all. All three kinds of caller have
    // them, which is why they are not inside the principal variant.
    const [described, org, role] = await Promise.all([
      this.describe(principal),
      new OrgService(this.container).current(),
      roleOf(this.container, principal),
    ])
    return {
      mode: this.container.auth.mode,
      principal: described,
      org,
      role,
      signInProviders: new ConnectionsService(this.container).signInProviders(),
    }
  }

  /**
   * The caller, with the person attached where there is one.
   *
   * The viewer is read through `ViewerService` with the SESSION principal, so it
   * is two store reads and no gateway call: this route is polled by the shell of
   * every page, and one that reached a source-control host per poll would spend
   * the deployment's rate limit on rendering a name.
   */
  private async describe(principal: RequestPrincipal): Promise<Principal> {
    if (principal.kind === 'anonymous') return { kind: 'anonymous' }
    if (principal.kind === 'api_key') {
      return { kind: 'api_key', keyId: principal.keyId, label: principal.label }
    }
    return {
      kind: 'session',
      session: sessionOnTheWire(principal.session),
      viewer: await new ViewerService(this.container, principal).current(),
    }
  }
}
