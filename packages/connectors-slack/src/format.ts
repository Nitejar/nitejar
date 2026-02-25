/**
 * Convert generic markdown to Slack mrkdwn.
 */
export function markdownToSlackMrkdwn(markdown: string): string {
  if (!markdown) return ''

  const codeBlocks: string[] = []
  const inlineCodes: string[] = []

  let text = markdown.replace(
    /```([\w-]*)\n([\s\S]*?)```/g,
    (_match, lang: string, body: string) => {
      const label = typeof lang === 'string' && lang.trim().length > 0 ? `${lang.trim()}\n` : ''
      codeBlocks.push(`\`\`\`${label}${body.trimEnd()}\`\`\``)
      return `@@SLOPBOT_SLACK_CODE_BLOCK_${codeBlocks.length - 1}@@`
    }
  )

  text = text.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    inlineCodes.push(`\`${code}\``)
    return `@@SLOPBOT_SLACK_INLINE_${inlineCodes.length - 1}@@`
  })

  text = text.replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
  text = text.replace(/\*\*(.+?)\*\*/g, '*$1*')
  text = text.replace(/~~(.+?)~~/g, '~$1~')
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<$2|$1>')

  text = text.replace(
    /@@SLOPBOT_SLACK_CODE_BLOCK_(\d+)@@/g,
    (_match, idx: string) => codeBlocks[Number.parseInt(idx, 10)] ?? ''
  )
  text = text.replace(
    /@@SLOPBOT_SLACK_INLINE_(\d+)@@/g,
    (_match, idx: string) => inlineCodes[Number.parseInt(idx, 10)] ?? ''
  )

  return text.trim()
}
