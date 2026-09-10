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
export type {
  AiReviewGateway,
  AiReviewHandle,
  AiReviewReport,
  ChatGateway,
  VcsGateway,
} from './ports/gateways.js'
export type {
  AiReviewRunRepository,
  ReminderRepository,
  Repositories,
  ReviewerRepository,
  ReviewRequestRepository,
} from './ports/repositories.js'
export {
  type Clock,
  type IdGenerator,
  type Logger,
  systemClock,
  uuidGenerator,
} from './ports/runtime.js'
