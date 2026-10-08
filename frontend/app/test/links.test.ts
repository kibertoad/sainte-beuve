import { describe, expect, it } from 'vitest'
import { safeHref } from '../app/utils/links'

describe('safeHref', () => {
  it('passes an http or https link through untouched', () => {
    expect(safeHref('https://github.com/kibertoad/sainte-beuve/pull/7')).toBe(
      'https://github.com/kibertoad/sainte-beuve/pull/7',
    )
    expect(safeHref('http://localhost:8787/tasks/1')).toBe('http://localhost:8787/tasks/1')
  })

  it('drops anything that would run or read rather than navigate', () => {
    expect(safeHref('javascript:alert(1)')).toBeUndefined()
    expect(safeHref('JAVASCRIPT:alert(1)')).toBeUndefined()
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeUndefined()
    expect(safeHref('not a url')).toBeUndefined()
  })

  it('renders no link for a missing one', () => {
    expect(safeHref(null)).toBeUndefined()
    expect(safeHref(undefined)).toBeUndefined()
  })
})
