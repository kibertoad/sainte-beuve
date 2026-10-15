import { ApiError, apiErrorMessage } from './sainteBeuveApi'

/** Where and when a failure was seen, read off the browser by the caller. */
export interface ErrorSurroundings {
  page: string
  apiBase: string
  at: Date
  userAgent: string
}

/** How much of a stack trace a report carries: enough to find the frame, short enough to paste. */
const STACK_LINES = 12

/**
 * A failure written up to paste into a ticket or hand to an LLM: what the screen
 * said, then everything needed to reproduce it, in Markdown both read.
 *
 * It never carries the request body. The configuration screens send tokens and
 * secrets through the same client, and a report is pasted somewhere public.
 */
export function errorReport(title: string, err: unknown, surroundings: ErrorSurroundings): string {
  const facts = [
    ...apiFacts(err),
    ['Page', surroundings.page],
    ['API', surroundings.apiBase],
    ['Time', surroundings.at.toISOString()],
    ['Browser', surroundings.userAgent],
  ]
  const sections = [
    `## ${title}`,
    apiErrorMessage(err),
    facts.map(([name, value]) => `- ${name}: ${value}`).join('\n'),
    ...detailsSection(err),
    ...stackSection(err),
  ]
  return `${sections.join('\n\n')}\n`
}

function apiFacts(err: unknown): string[][] {
  if (!(err instanceof ApiError)) {
    return [['Error', err instanceof Error ? err.name : typeof err]]
  }
  return [
    ['Request', err.endpoint ?? 'unknown'],
    ['Status', err.statusCode === 0 ? 'not sent, or no response' : String(err.statusCode)],
    ['Code', err.code],
  ]
}

function detailsSection(err: unknown): string[] {
  if (!(err instanceof ApiError) || err.details === undefined) return []
  return ['### Details', fenced('json', JSON.stringify(err.details, null, 2))]
}

/** An API refusal's stack is the client's own plumbing; anything else's is the clue. */
function stackSection(err: unknown): string[] {
  if (err instanceof ApiError || !(err instanceof Error) || !err.stack) return []
  return ['### Stack', fenced('', err.stack.split('\n').slice(0, STACK_LINES).join('\n'))]
}

function fenced(language: string, text: string): string {
  return `\`\`\`${language}\n${text}\n\`\`\``
}
