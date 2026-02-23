/**
 * Extract @mentions from text, filtering to known agent handles.
 */
export function extractMentions(text: string, knownHandles: string[]): string[] {
  if (!text || knownHandles.length === 0) return []

  const handleSet = new Set(knownHandles.map((h) => h.toLowerCase()))
  // Support hyphenated handles like @nitejar-dev in addition to underscores.
  const mentionRegex = /@([a-z0-9_][a-z0-9_-]*)/gi
  const found = new Set<string>()

  let match: RegExpExecArray | null
  while ((match = mentionRegex.exec(text)) !== null) {
    const handle = match[1]!.toLowerCase()
    if (handleSet.has(handle)) {
      found.add(handle)
    }
  }

  return [...found]
}
