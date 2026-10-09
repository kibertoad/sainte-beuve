import { describe, expect, it } from 'vitest'
import { mergeVocabulary } from './vocabulary.js'

describe('mergeVocabulary', () => {
  it('takes the known spelling and reports only what is new', () => {
    expect(mergeVocabulary(['billing'], ['Billing', 'onboarding'])).toStrictEqual({
      values: ['billing', 'onboarding'],
      added: ['onboarding'],
    })
  })

  it('drops blanks and duplicates, including a new entry given twice', () => {
    expect(mergeVocabulary([], ['search', ' ', 'Search'])).toStrictEqual({
      values: ['search'],
      added: ['search'],
    })
  })
})
