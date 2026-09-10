/**
 * Enough of a credential to recognise it, and far too little to use it.
 *
 * One constant rather than a `slice(-4)` at each of the two places a credential
 * is stored (a pasted token, and the one a sign-in returns), because the hint is
 * what an operator compares against the token in their password manager: two
 * lengths would make the same credential look like two.
 */
export const HINT_LENGTH = 4

export function hintOf(token: string): string {
  return token.slice(-HINT_LENGTH)
}
