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
export { DEFAULT_REMINDER_POLICY, type EpochMs, formatPullRequest } from './domain/types.js'
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
  VcsGateway,
} from './ports/gateways.js'
export type {
  AiReviewRunRepository,
  IntegrationTokenRepository,
  ReminderRepository,
  Repositories,
  ReviewerRepository,
  ReviewRequestRepository,
  StoredIntegrationToken,
} from './ports/repositories.js'
export {
  type Clock,
  type IdGenerator,
  type Logger,
  systemClock,
  uuidGenerator,
} from './ports/runtime.js'
