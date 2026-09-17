import type { IntegrationId, VcsProvider } from '@sainte-beuve/contracts'
import {
  clearIntegrationTokenContract,
  disconnectVcsSignInContract,
  getConnectionsContract,
  getIntegrationSettingsContract,
  setIntegrationTokenContract,
  startGitHubAppInstallContract,
  startVcsSignInContract,
} from '@sainte-beuve/contracts'
import type { ContractCaller } from './contractCall'

// The Configuration screen's half of the client: this deployment's credentials
// and how it reaches each host.
//
// Split off `sainteBeuveApi.ts` on the seam the ROUTES already use — every
// contract here is under `/api/v1/settings`, which is the prefix excluded from
// the wildcard CORS default and, since the org boundary, the group an admin
// holds and a member does not. The file it came from was at its size budget, and
// this is where it divides without cutting anything in half.
//
// It takes the CALLER rather than building one, so there is still exactly one
// wretch client, one `credentials: 'include'`, and one place a refusal becomes an
// `ApiError`.

export function configurationCalls(call: ContractCaller) {
  return {
    getIntegrationSettings: () => call(getIntegrationSettingsContract, {}),
    // A token goes out and never comes back: what returns is the integration's
    // state, which is all the screen renders.
    setIntegrationToken: (integrationId: IntegrationId, token: string) =>
      call(setIntegrationTokenContract, { pathParams: { integrationId }, body: { token } }),
    clearIntegrationToken: (integrationId: IntegrationId) =>
      call(clearIntegrationTokenContract, { pathParams: { integrationId } }),

    getConnections: () => call(getConnectionsContract, {}),
    /**
     * Where to send the browser to start a connect round trip. Fetched rather
     * than navigated to, because each call MINTS a signed state with a few
     * minutes of life: the URL has to be the one the operator clicks, not the one
     * a poll happened to produce.
     */
    startGitHubAppInstall: () => call(startGitHubAppInstallContract, {}),
    startSignIn: (provider: VcsProvider) =>
      call(startVcsSignInContract, { pathParams: { provider } }),
    disconnectSignIn: (provider: VcsProvider) =>
      call(disconnectVcsSignInContract, { pathParams: { provider } }),
  }
}
