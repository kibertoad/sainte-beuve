// Shared vocabulary, domain errors and port interfaces for the sainte-beuve
// packages. Nothing here reaches a network or a database.

export {
  assertFound,
  ConflictError,
  DomainError,
  type DomainErrorCode,
  ForbiddenError,
  getErrorMessage,
  isDomainError,
  NotFoundError,
  UnavailableError,
  UpstreamFailedError,
  ValidationError,
} from './domain/errors.js'
export { projectRefKey, pullRequestKey } from './domain/keys.js'
export { DEFAULT_REMINDER_POLICY, type EpochMs, formatPullRequest } from './domain/types.js'
export { base64url, base64urlText, base64urlToBytes, timingSafeEqual } from './encoding.js'
export {
  isSecretDecryptError,
  type SecretCipher,
  SecretDecryptError,
  type SecretDecryptFailure,
  type SecretEnvelopeState,
} from './ports/crypto.js'
export type {
  AiReviewGateway,
  AiReviewHandle,
  AiReviewReport,
  ChatGateway,
  GatewayFactory,
  VcsAccount,
  VcsGateway,
  VcsIdentityGateway,
} from './ports/gateways.js'
export type { AttentionBus } from './ports/realtime.js'
export type {
  AiReviewRunRepository,
  AttentionRepository,
  IdentityRepository,
  IntegrationTokenRepository,
  PersistenceKind,
  ProjectRepository,
  ReminderRepository,
  Repositories,
  ReviewCommitmentRepository,
  ReviewerRepository,
  ReviewRequestRepository,
  StoredIntegrationToken,
} from './ports/repositories.js'
export type { RoundTripState, StateSigner } from './ports/state.js'
export {
  type Clock,
  type IdGenerator,
  type Logger,
  systemClock,
  uuidGenerator,
} from './ports/runtime.js'
