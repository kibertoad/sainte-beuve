/**
 * The short-lived signed value carried through a third-party round trip.
 *
 * An OAuth sign-in and a GitHub App install both leave the deployment, land in
 * somebody's browser, and come back as a GET nobody authenticated. The state is
 * what makes the return leg trustworthy: the callback accepts only a value THIS
 * deployment signed, recently, for the flow it claims to be for. Without it a
 * third party can hand an operator a link that binds their own GitHub account to
 * this deployment's credential store.
 *
 * OPTIONAL on the container, like every other capability. The signer is built
 * from the same key that seals the credentials (see `SecretCipher`), because a
 * connect flow whose only purpose is to store a credential cannot be useful
 * without one: they are configured together or not at all.
 */

/** What a round trip carries out and has to bring back. */
export interface RoundTripState {
  /** Which flow the state was minted for, so one flow's state cannot be presented to another. */
  flow: string
  /**
   * Which BROWSER started the flow. The same value is put in a short-lived
   * cookie when the state is minted, and the callback accepts the round trip
   * only where the two match.
   *
   * Signed and recent is not enough on its own: an attacker can start a flow
   * here perfectly legitimately, get back a state this deployment really did
   * sign, and then hand the finished callback URL to somebody else — who
   * completes it and is signed in as the attacker, on the attacker's account,
   * with whatever they do next visible to them. Binding the state to the
   * browser that asked for it is what makes the return leg the same person's.
   */
  nonce: string
  /**
   * The tenancy the round trip is for.
   *
   * SIGNED, because it is the one moment an org is chosen by something a caller
   * sent: a sign-in names a slug, and the session that comes back is bound to
   * whatever this says. In the query string unsigned, it would let anybody who
   * can hand somebody a URL decide which org they land in.
   */
  orgId: string
  /** Where to send the browser once the callback has done its work. Null for the default. */
  returnTo: string | null
  /** Absolute expiry, epoch ms. */
  exp: number
}

export interface StateSigner {
  /** Sign the claims into an opaque value safe to put in a query string. */
  sign(state: RoundTripState): Promise<string>
  /**
   * The claims behind a state this deployment signed for `flow` and which has not
   * expired, or null for anything else. Never throws on a malformed value: a
   * callback reached with garbage has to fail closed, not 500.
   */
  verify(value: string | null, flow: string): Promise<RoundTripState | null>
}
