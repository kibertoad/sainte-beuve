import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { hasCodeFence, leadOf, renderMarkdown } from '../app/utils/markdown'

function html(source: string): Promise<string> {
  return renderToString(h('div', renderMarkdown(source)))
}

describe('renderMarkdown', () => {
  it('renders inline code, emphasis and lists', async () => {
    const out = await html('Use `poll()` **once**, _not_ twice.\n\n- one\n- two')
    expect(out).toContain('<code')
    expect(out).toContain('poll()</code>')
    expect(out).toContain('<strong>once</strong>')
    expect(out).toContain('<em>not</em>')
    expect(out).toMatch(/<ul[^>]*><li>.*one.*<\/li><li>.*two.*<\/li><\/ul>/)
  })

  it('renders a fenced block as wrapped monospace', async () => {
    const out = await html('```ts\nconst a = 1 < 2\n```')
    expect(out).toContain('<pre class="')
    expect(out).toContain('whitespace-pre-wrap')
    expect(out).toContain('const a = 1 &lt; 2')
  })

  it('shows raw HTML as text instead of markup', async () => {
    const out = await html('a <img src=x onerror=alert(1)> b')
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('drops a link whose href is not a web URL', async () => {
    const out = await html('[bad](javascript:alert(1)) [good](https://example.com)')
    expect(out).not.toContain('javascript:')
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('rel="noopener noreferrer"')
  })
})

describe('leadOf', () => {
  it('keeps the first sentence and says the rest is hidden', () => {
    expect(leadOf('The lock leaks. It is never released on error.')).toEqual({
      lead: 'The lock leaks.',
      truncated: true,
    })
  })

  it('does not end a sentence inside inline code', () => {
    expect(leadOf('Calls `a.b. c` twice. Then more.').lead).toBe('Calls `a.b. c` twice.')
  })

  it('stops at the first paragraph', () => {
    expect(leadOf('No sentence end here\n\nSecond paragraph.')).toEqual({
      lead: 'No sentence end here',
      truncated: true,
    })
  })

  it('stops before a fenced block', () => {
    expect(leadOf('See this\n```ts\nx()\n```').lead).toBe('See this')
  })

  it('reports nothing hidden for a one-sentence body', () => {
    expect(leadOf('  Short and done.  ')).toEqual({ lead: 'Short and done.', truncated: false })
  })

  it('keeps the whole body as the lead when it opens with a fence', () => {
    const body = '```ts\nx()\n```\nWhy.'
    expect(leadOf(body)).toEqual({ lead: body, truncated: true })
  })
})

describe('hasCodeFence', () => {
  it('tells a fenced fix from plain code', () => {
    expect(hasCodeFence('Replace with:\n```ts\nx()\n```')).toBe(true)
    expect(hasCodeFence('const x = `a`')).toBe(false)
  })
})
