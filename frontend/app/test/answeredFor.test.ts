import { describe, expect, it } from 'vitest'
import { answerFor } from '../app/utils/answeredFor'

// The failure this exists for: the AI review page said "nobody has asked for a
// review" while it was still loading one, because the previous review's empty
// answer was still on screen.

describe('answerFor', () => {
  it('answers with the value only when it is about the subject asked for', () => {
    const answered = { subject: 'review-a', value: { runs: [] } }
    expect(answerFor(answered, 'review-a')).toStrictEqual({ runs: [] })
    expect(answerFor(answered, 'review-b')).toBeUndefined()
  })

  it('answers undefined before anything has loaded', () => {
    expect(answerFor(undefined, 'review-a')).toBeUndefined()
  })
})
