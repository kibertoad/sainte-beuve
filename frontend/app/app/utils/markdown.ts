import type { Token, Tokens } from 'marked'
import { Lexer } from 'marked'
import { h, type VNode, type VNodeArrayChildren } from 'vue'
import { safeHref } from './links'

// Markdown a model wrote, rendered as Vue nodes rather than as an HTML string.
// Nothing reaches the page as markup: raw HTML in the source shows as text, and
// a link keeps its href only when it is a web URL.

const CODE_BLOCK = 'text-xs font-mono p-2 rounded bg-elevated whitespace-pre-wrap break-words'

type Render = (token: Token) => VNode | string

function children(tokens: Token[] | undefined): VNodeArrayChildren {
  return (tokens ?? []).map(renderToken)
}

function renderList(token: Tokens.List): VNode {
  const items = token.items.map((item) => h('li', children(item.tokens)))
  return token.ordered
    ? h('ol', { class: 'list-decimal ps-5', start: token.start || undefined }, items)
    : h('ul', { class: 'list-disc ps-5' }, items)
}

function renderLink(token: Tokens.Link): VNode {
  const href = safeHref(token.href)
  if (href === undefined) return h('span', children(token.tokens))
  return h(
    'a',
    { href, target: '_blank', rel: 'noopener noreferrer', class: 'text-primary underline' },
    children(token.tokens),
  )
}

const RENDERERS: Partial<Record<string, Render>> = {
  space: () => '',
  paragraph: (t) => h('p', children((t as Tokens.Paragraph).tokens)),
  heading: (t) => h('p', { class: 'font-semibold' }, children((t as Tokens.Heading).tokens)),
  text: (t) => {
    const text = t as Tokens.Text
    return text.tokens ? h('span', children(text.tokens)) : text.text
  },
  codespan: (t) =>
    h(
      'code',
      { class: 'font-mono text-[0.9em] px-1 rounded bg-elevated' },
      (t as Tokens.Codespan).text,
    ),
  code: (t) => h('pre', { class: CODE_BLOCK }, h('code', (t as Tokens.Code).text)),
  strong: (t) => h('strong', children((t as Tokens.Strong).tokens)),
  em: (t) => h('em', children((t as Tokens.Em).tokens)),
  del: (t) => h('del', children((t as Tokens.Del).tokens)),
  br: () => h('br'),
  hr: () => h('hr', { class: 'border-default' }),
  blockquote: (t) =>
    h(
      'blockquote',
      { class: 'border-l-2 border-default pl-3' },
      children((t as Tokens.Blockquote).tokens),
    ),
  list: (t) => renderList(t as Tokens.List),
  link: (t) => renderLink(t as Tokens.Link),
  image: (t) => (t as Tokens.Image).text,
}

function renderToken(token: Token): VNode | string {
  const render = RENDERERS[token.type]
  if (render) return render(token)
  return 'text' in token && typeof token.text === 'string' ? token.text : token.raw
}

/** The nodes for a markdown source, to render inside a container element. */
export function renderMarkdown(source: string): VNodeArrayChildren {
  return children(Lexer.lex(source, { gfm: true }))
}

/** Whether a source carries a fenced code block, which is what marks a fix as markdown. */
export function hasCodeFence(source: string): boolean {
  return /^\s*(```|~~~)/m.test(source)
}

/**
 * The opening of a finding's body: its first sentence, within its first
 * paragraph, so a long finding reads as a headline until it is opened. A
 * sentence ends at `.`, `!` or `?` before whitespace, never inside inline code.
 */
export function leadOf(source: string): { lead: string; truncated: boolean } {
  const text = source.trim()
  if (/^(```|~~~)/.test(text)) return { lead: text, truncated: true }
  const paragraph = text.split(/\n\s*\n|\n\s*(?:```|~~~)/)[0]?.trim() ?? ''
  const end = sentenceEnd(paragraph)
  const lead = end === -1 ? paragraph : paragraph.slice(0, end + 1)
  return { lead, truncated: lead.length < text.length }
}

function sentenceEnd(text: string): number {
  let inCode = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '`') inCode = !inCode
    else if (!inCode && '.!?'.includes(char ?? '') && /\s/.test(text[index + 1] ?? '')) {
      return index
    }
  }
  return -1
}
