import { repositoryMissingOf } from '@sainte-beuve/contracts'
import { ApiError } from './sainteBeuveApi'

/** A button on an error toast: a link out, or something to run again. */
export interface RefusalAction {
  label: string
  to?: string
  target?: '_blank'
  onClick?: () => void
}

/**
 * What an error toast can offer besides the message. A repository cat-factory
 * has no service for gets a link that adds it there, and then the retry, since
 * the action that failed will work once the service exists.
 */
export function refusalActions(err: unknown, retry?: () => void): RefusalAction[] {
  if (!(err instanceof ApiError)) return []
  const missing = repositoryMissingOf(err.details)
  if (missing === null) return []
  const add: RefusalAction = {
    label: `Add ${missing.repository} in cat-factory`,
    to: missing.addRepositoryUrl,
    target: '_blank',
  }
  return retry === undefined ? [add] : [add, { label: 'Retry', onClick: retry }]
}
