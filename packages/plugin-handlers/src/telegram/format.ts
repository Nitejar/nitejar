/**
 * Convert standard markdown to Telegram-compatible HTML.
 *
 * Telegram's HTML mode supports: <b>, <i>, <u>, <s>, <code>, <pre>, <a>, <blockquote>
 * Everything else degrades to plain text.
 */
export function markdownToTelegramHtml(md: string): string {
  // Phase 1: Extract code blocks and inline code to protect them from other transformations
  const codeBlocks: string[] = []
  const inlineCodes: string[] = []
  // Use token delimiters that won't match markdown emphasis patterns.
  const codeBlockToken = '@@SLOPBOT_CODE_BLOCK_'
  const inlineCodeToken = '@@SLOPBOT_INLINE_CODE_'

  // Extract fenced code blocks (```lang\n...\n```)
  let text = md.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang: string, code: string) => {
    const escaped = escapeHtml(code.trimEnd())
    const block = lang
      ? `<pre><code class="language-${escapeHtml(lang)}">${escaped}</code></pre>`
      : `<pre>${escaped}</pre>`
    codeBlocks.push(block)
    return `${codeBlockToken}${codeBlocks.length - 1}@@`
  })

  // Extract inline code (`...`)
  text = text.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`)
    return `${inlineCodeToken}${inlineCodes.length - 1}@@`
  })

  // Phase 2: HTML-escape the remaining text
  text = escapeHtml(text)

  // Phase 3: Convert markdown formatting to HTML

  // Bold: **text** or __text__
  text = text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  text = text.replace(/__(.+?)__/g, '<b>$1</b>')

  // Italic: *text* or _text_ (but not inside words with underscores)
  text = text.replace(/(?<!\w)\*([^\s*](?:.*?[^\s*])?)\*(?!\w)/g, '<i>$1</i>')
  text = text.replace(/(?<!\w)_([^\s_](?:.*?[^\s_])?)_(?!\w)/g, '<i>$1</i>')

  // Strikethrough: ~~text~~
  text = text.replace(/~~(.+?)~~/g, '<s>$1</s>')

  // Links: [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

  // Headers: # text → bold line (h1-h6)
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')

  // Blockquotes: > text
  text = text.replace(/^&gt;\s?(.+)$/gm, '<blockquote>$1</blockquote>')
  // Merge adjacent blockquotes
  text = text.replace(/<\/blockquote>\n<blockquote>/g, '\n')

  // Phase 4: Re-insert code blocks and inline code
  text = text.replace(
    /@@SLOPBOT_CODE_BLOCK_(\d+)@@/g,
    (_match, idx: string) => codeBlocks[parseInt(idx)] ?? ''
  )
  text = text.replace(
    /@@SLOPBOT_INLINE_CODE_(\d+)@@/g,
    (_match, idx: string) => inlineCodes[parseInt(idx)] ?? ''
  )

  return text.trim()
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
