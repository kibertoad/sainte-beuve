import type {
  ApiContract,
  ClientRequestParams,
  InferNonSseClientResponse,
  SuccessfulHttpStatusCode,
} from '@toad-contracts/core'

// What it means to call a route contract, for both halves of the client.
//
// Its own module because `sainteBeuveApi.ts` and `sainteBeuveSettingsApi.ts` both
// need these three and neither should own them: the settings half takes the
// CALLER rather than building one, so there is exactly one wretch client, one
// `credentials: 'include'` and one place a refusal becomes an `ApiError`, and a
// type it had to import back from the module that imports it would be a cycle
// for no reason.

/** What a call resolves to: the body of the contract's success response. */
export type SuccessBody<TContract extends ApiContract> = Extract<
  InferNonSseClientResponse<TContract>,
  { statusCode: SuccessfulHttpStatusCode }
>['body']

/**
 * What a contract has to be called with, inferred from it: path params where it
 * declares them, a body where it declares one, and nothing where it does not.
 */
export type RequestParams<TContract extends ApiContract> = ClientRequestParams<TContract, false>

/** One typed request through the shared client. See `createSainteBeuveApi`. */
export type ContractCaller = <TContract extends ApiContract>(
  contract: TContract,
  params: RequestParams<TContract>,
) => Promise<SuccessBody<TContract>>
