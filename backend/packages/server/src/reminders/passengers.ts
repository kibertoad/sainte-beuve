import type { AppContainer } from '../container.js'
import { SessionService } from '../modules/auth/SessionService.js'
import { RepositorySyncService } from '../modules/projects/RepositorySyncService.js'
import { AiReviewService } from '../modules/reviews/AiReviewService.js'
import type { TickResult } from './tick.js'

/** What one org's passengers did. The half that rides whatever budget is left. */
export type Passengers = Pick<
  TickResult,
  'sessionsSwept' | 'aiReviewsPolled' | 'repositoriesSynced'
>

/** One org's passengers, run once every org's nudges have gone out. */
export async function ridePassengers(
  container: AppContainer,
  batchSize: number,
): Promise<Passengers> {
  return {
    sessionsSwept: await sweepSessions(container),
    aiReviewsPolled: await pollAiReviews(container, batchSize),
    repositoriesSynced: await syncRepositories(container),
  }
}

/** Like the other passengers, a failed sync does not fail the tick; it is recorded for the screen. */
async function syncRepositories(container: AppContainer): Promise<number> {
  try {
    return await new RepositorySyncService(container).tick()
  } catch (err) {
    container.logger.warn({ err }, 'could not sync repositories from cat-factory')
    return 0
  }
}

/**
 * A sweep that fails does NOT fail the tick. The reminders in this pass have
 * already gone out, and a store that refused a delete is a fault an operator
 * reads in the log rather than a reason to re-send every nudge next minute.
 */
async function sweepSessions(container: AppContainer): Promise<number> {
  try {
    return await new SessionService(container).sweepExpired()
  } catch (err) {
    container.logger.warn({ err }, 'could not sweep expired sessions')
    return 0
  }
}

/**
 * Ask cat-factory where this org's delegated reviews got to.
 *
 * The same batch cap as the nudges, for the same reason: every poll is an
 * outbound call, and a tenancy with two hundred runs in flight would otherwise
 * spend one tick's whole budget here. The LEAST RECENTLY POLLED are read first,
 * so what the cap leaves over is picked up next tick rather than starved. See
 * `AiReviewRunRepository.listInFlight`, where that ordering is the difference
 * between a cap and a queue nothing ever leaves.
 *
 * A sweep that fails does NOT fail the tick, exactly as the session sweep does
 * not: the reminders in this pass have already gone out, and a cat-factory that
 * is unreachable for a minute is not a reason to re-send every nudge next
 * minute. A poll that is merely refused never reaches here: the service records
 * that on the run, where the board shows it.
 */
async function pollAiReviews(container: AppContainer, batchSize: number): Promise<number> {
  try {
    return await new AiReviewService(container).sweepInFlight(batchSize)
  } catch (err) {
    container.logger.warn({ err }, 'could not poll the AI reviews in flight')
    return 0
  }
}
