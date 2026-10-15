import { describe, expect, it } from 'vitest'
import { errorReport } from '../app/utils/errorReport'
import { ApiError } from '../app/utils/sainteBeuveApi'

const surroundings = {
  page: 'http://localhost:3088/configuration/organization',
  apiBase: 'http://localhost:8788',
  at: new Date('2026-10-16T12:00:00Z'),
  userAgent: 'test-agent',
}

describe('errorReport', () => {
  it('names the route, the status, the code and the refused fields of an API refusal', () => {
    const err = new ApiError(0, 'invalid_request', 'This request was refused before it was sent', {
      issues: [{ path: 'mergeComments.0.label', message: 'Invalid length' }],
    })
    err.endpoint = 'PATCH /api/v1/org'

    const report = errorReport('Could not save the organization', err, surroundings)

    expect(report).toContain('## Could not save the organization')
    expect(report).toContain('- Request: PATCH /api/v1/org')
    expect(report).toContain('- Status: not sent, or no response')
    expect(report).toContain('- Code: invalid_request')
    expect(report).toContain('"path": "mergeComments.0.label"')
    expect(report).toContain(`- Page: ${surroundings.page}`)
    expect(report).toContain('- Time: 2026-10-16T12:00:00.000Z')
    expect(report).not.toContain('### Stack')
  })

  it('carries the stack of a failure that is not an API refusal', () => {
    const report = errorReport('Could not load', new TypeError('Failed to fetch'), surroundings)

    expect(report).toContain('Failed to fetch')
    expect(report).toContain('- Error: TypeError')
    expect(report).toContain('### Stack')
  })
})
