import * as v from 'valibot'

// ---------------------------------------------------------------------------
// Running AI reviews on a person's own model subscription.
//
// cat-factory runs a subscription only for a person: through an API key that
// person minted as themselves ("Runs as" in cat-factory), with their personal
// password in a header on every call that starts or answers a run. The org's
// key acts as nobody, so a pipeline whose models need a subscription refuses
// it. Each person stores their own key here, and the SPA sends the password,
// which nothing here stores.
// ---------------------------------------------------------------------------

/** The header the personal password travels in: from the SPA to here, and on to cat-factory. */
export const PERSONAL_PASSWORD_HEADER = 'x-personal-password'

/**
 * What a review on the personal route still needs from the person:
 *
 * - `personal_key`: their own cat-factory key, stored on the Configuration screen
 * - `password`: their personal password, which the SPA asks for and caches
 * - `wrong_password`: the password sent did not open their subscription
 * - `subscription` / `subscription_expired`: nothing to open, connect or renew it in cat-factory
 * - `retry`: the org has just been found to need the personal route, and the person has what
 *   it takes, so the same call made again goes that way
 */
export const personalRouteNeedSchema = v.picklist([
  'personal_key',
  'password',
  'wrong_password',
  'subscription',
  'subscription_expired',
  'retry',
])
export type PersonalRouteNeed = v.InferOutput<typeof personalRouteNeedSchema>

export const CAT_FACTORY_PERSONAL_ROUTE = 'cat_factory_personal_route'

/** The `details` of a refusal a person can fix by supplying their own credential. */
export const catFactoryPersonalRouteSchema = v.object({
  reason: v.literal(CAT_FACTORY_PERSONAL_ROUTE),
  need: personalRouteNeedSchema,
  /** The subscription vendor cat-factory named, e.g. `claude`. Null when it named none. */
  vendor: v.nullable(v.string()),
})
export type CatFactoryPersonalRoute = v.InferOutput<typeof catFactoryPersonalRouteSchema>

/** The refusal's details when that is what they are, else null. */
export function personalRouteOf(details: unknown): CatFactoryPersonalRoute | null {
  const parsed = v.safeParse(catFactoryPersonalRouteSchema, details)
  return parsed.success ? parsed.output : null
}

/** The caller's side of it: whether the org needs the personal route, and their key. */
export const catFactoryPersonalSchema = v.object({
  /**
   * `required` once cat-factory has refused this org's key for a model that needs a
   * personal subscription. Forgotten when the cat-factory settings change.
   */
  personalRoute: v.picklist(['required', 'not_known']),
  key: v.object({
    stored: v.boolean(),
    /** The last four characters of the stored key. Null when there is none. */
    hint: v.nullable(v.string()),
  }),
})
export type CatFactoryPersonal = v.InferOutput<typeof catFactoryPersonalSchema>

export const setCatFactoryPersonalKeySchema = v.object({
  token: v.pipe(v.string(), v.trim(), v.minLength(8), v.maxLength(1024)),
})
export type SetCatFactoryPersonalKey = v.InferOutput<typeof setCatFactoryPersonalKeySchema>

/** The store key one person's cat-factory key is held under, beside the org's credentials. */
export type PersonalCatFactoryKey = `cat-factory-personal:${string}`

export function personalCatFactoryKey(reviewerId: string): PersonalCatFactoryKey {
  return `cat-factory-personal:${reviewerId}`
}
