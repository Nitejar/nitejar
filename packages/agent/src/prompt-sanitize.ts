/**
 * Prompt boundary sanitization — defense-in-depth for LLM prompt injection.
 *
 * Non-deterministic content (user text, agent text, tool output, webhook data,
 * repo files, memories) flows into LLM prompts throughout the pipeline. This
 * module provides structural boundaries (XML tags) and content sanitization
 * (escaping reserved tags, stripping control characters) to prevent injected
 * content from breaking prompt structure.
 *
 * Three primitives:
 * - escapeStructuralTags — escapes only our reserved XML tag names in content
 * - sanitize — main entry: escapes structural tags + strips control characters
 * - escapeXmlText — escapes all XML metacharacters for text embedded inside
 *   arbitrary XML-like sections (for example faux section wrappers in prompts)
 * - sanitizeLabel — for bracket-delimited labels derived from user-controlled fields
 * - wrapBoundary — sanitizes content, then wraps in structural XML tags
 */

/**
 * Reserved XML tag names used as structural boundaries in prompts.
 * These are the ONLY tags we escape — everything else (HTML, markdown, code
 * comparisons like `x < y`) passes through untouched.
 */
export const RESERVED_TAGS = [
  'transcript',
  'context',
  'memory',
  'activity',
  'preamble',
  'tool-output',
  'attachment',
] as const

export type ReservedTag = (typeof RESERVED_TAGS)[number]

/**
 * Regex that matches opening, closing, and self-closing forms of reserved tags.
 * Case-insensitive, captures optional attributes and self-closing slash.
 *
 * Matches:
 *   <transcript>        — opening
 *   </transcript>       — closing
 *   <transcript/>       — self-closing
 *   <transcript />      — self-closing with space
 *   <memory role="x">   — opening with attributes
 *   <TRANSCRIPT>        — case variants
 *
 * Does NOT match already-escaped `&lt;transcript&gt;` (idempotency).
 */
function buildReservedTagRegex(): RegExp {
  const tagNames = RESERVED_TAGS.join('|')
  // Match < (optional /) (tagName) (optional attributes) (optional self-close /) >
  // Negative lookbehind for &lt; ensures idempotency
  return new RegExp(
    `(?<!&lt;)` + // not already escaped
      `<(/?)(${tagNames})` + // < or </ then tag name
      `((?:\\s+[^>]*)?)` + // optional attributes
      `(\\s*/?)>`, // optional self-close /> then >
    'gi'
  )
}

/**
 * Escape only our reserved XML tag names in content.
 *
 * Does NOT escape all `<` — that would corrupt code blocks, markdown,
 * comparisons like `x < y`. Only targets our specific structural tags.
 *
 * Idempotent: already-escaped `&lt;transcript&gt;` stays as-is.
 */
export function escapeStructuralTags(text: string): string {
  if (!text) return text
  const regex = buildReservedTagRegex()
  return text.replace(regex, (_match, slash, tagName, attrs, selfClose) => {
    return `&lt;${slash as string}${tagName as string}${attrs as string}${selfClose as string}&gt;`
  })
}

/**
 * Control character regex — matches null bytes, SOH, BEL, etc.
 * Preserves \n (0x0A), \r (0x0D), \t (0x09).
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g

function stripControlChars(text: string): string {
  return text.replace(CONTROL_CHAR_REGEX, '')
}

/**
 * Main sanitization entry point. Combines:
 * - Control character stripping (null bytes, SOH, BEL, etc.)
 * - Structural tag escaping for boundary protection
 */
export function sanitize(text: string): string {
  if (!text) return text
  // Strip control characters first, then escape structural tags
  return escapeStructuralTags(stripControlChars(text))
}

/**
 * Escape text for insertion inside XML-like section payloads.
 *
 * Unlike sanitize(), this escapes ALL XML metacharacters so user-provided text
 * cannot impersonate arbitrary section tags like <recent_conversation>.
 */
export function escapeXmlText(text: string): string {
  if (!text) return text
  return stripControlChars(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Sanitize labels derived from user-controlled fields that appear in
 * bracket-delimited markers like `[Name (@username)]:`.
 *
 * Strips `[`, `]`, newlines, and `:` to prevent label spoofing.
 * Returns a fallback if the result is empty.
 */
export function sanitizeLabel(text: string, fallback: string = 'Unknown'): string {
  if (!text) return fallback
  // Escape structural tags first (prevents </transcript><memory>... in labels),
  // then strip brackets, newlines, and colons that could spoof label boundaries.
  const cleaned = sanitize(text)
    .replace(/[[\]\n\r]/g, '')
    .replace(/:/g, '')
    .trim()
  return cleaned || fallback
}

/**
 * Escape special characters in XML attribute values.
 */
function escapeAttrValue(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

/**
 * Validate that an attribute key is safe (alphanumeric + hyphens only).
 */
function isValidAttrKey(key: string): boolean {
  return /^[a-zA-Z0-9-]+$/.test(key)
}

/**
 * Sanitize content and wrap it in structural XML boundary tags.
 *
 * Defense-in-depth: even if escaping misses something, the real tags are
 * added by us and are structurally distinct from anything in the content.
 */
export function wrapBoundary(
  tag: ReservedTag,
  content: string,
  attrs?: Record<string, string>
): string {
  const sanitizedContent = sanitize(content)

  let attrStr = ''
  if (attrs) {
    const parts: string[] = []
    for (const [key, value] of Object.entries(attrs)) {
      if (!isValidAttrKey(key)) {
        throw new Error(`Invalid attribute key: "${key}" — must be alphanumeric + hyphens only`)
      }
      parts.push(`${key}="${escapeAttrValue(value)}"`)
    }
    if (parts.length > 0) {
      attrStr = ' ' + parts.join(' ')
    }
  }

  return `<${tag}${attrStr}>\n${sanitizedContent}\n</${tag}>`
}
