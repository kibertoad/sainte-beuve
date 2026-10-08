import type { AiReviewGateway, GuidedReviewGateway } from '@sainte-beuve/kernel'
import type { AppContainer } from '../src/container.js'
import { secretsFrom } from '../src/crypto/WebCryptoSecretCipher.js'
import { writeCatFactoryConfig } from '../src/integrations/catFactoryConfig.js'
import { stubGateways } from './helpers.js'

const quiet = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

/** The key `catFactoryWired` seals with, base64 of 32 bytes. */
const CAT_FACTORY_TEST_KEY = btoa('0123456789abcdef0123456789abcdef')

/**
 * A container that can reach a stubbed cat-factory once an org connects it: a
 * cipher to seal the key with, and a factory answering with the stubs. Pair it
 * with {@link connectCatFactory}, which stores what the Configuration screen
 * would.
 */
export function catFactoryWired(stubs: {
  aiReview?: AiReviewGateway
  guidedReview?: GuidedReviewGateway
}): Partial<AppContainer> {
  const wiring = secretsFrom({ masterKeyBase64: CAT_FACTORY_TEST_KEY, logger: quiet })
  return {
    secrets: wiring.cipher,
    states: wiring.states,
    gateways: stubGateways({
      ...(stubs.aiReview === undefined
        ? {}
        : { aiReview: () => stubs.aiReview as AiReviewGateway }),
      ...(stubs.guidedReview === undefined
        ? {}
        : { guidedReview: () => stubs.guidedReview as GuidedReviewGateway }),
    }),
  }
}

/** Store a cat-factory configuration and a sealed key in the container's org. */
export async function connectCatFactory<T extends { container: AppContainer }>(
  harness: T,
): Promise<T> {
  const { container } = harness
  const cipher = container.secrets
  if (cipher === null) throw new Error('connectCatFactory needs a cipher: use catFactoryWired')
  await writeCatFactoryConfig(container, {
    baseUrl: 'https://cat-factory.example.com',
    serviceId: 'svc-1',
    pipelineId: null,
  })
  await container.repositories.integrationTokens.put({
    integrationId: 'cat-factory',
    sealed: await cipher.encrypt('cf_live_test.secret', 'cat-factory'),
    hint: 'cret',
    subject: null,
    updatedAt: container.clock.now(),
  })
  return harness
}
