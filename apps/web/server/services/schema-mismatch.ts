const SCHEMA_MISMATCH_PATTERNS: RegExp[] = [
  /table\s+.+\s+has\s+no\s+column\s+named\s+.+/i,
  /no such column/i,
  /column\s+.+\s+does not exist/i,
  /no such table/i,
  /relation\s+.+\s+does not exist/i,
  /undefined column/i,
  /undefined table/i,
]

const loggedMessages = new Set<string>()

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export function isSchemaMismatchError(error: unknown): boolean {
  const message = stringifyError(error)
  return SCHEMA_MISMATCH_PATTERNS.some((pattern) => pattern.test(message))
}

export function formatSchemaMismatchMessage(error: unknown, context: string): string {
  const message = stringifyError(error)
  return [
    `[${context}] Database schema mismatch detected.`,
    `Run: pnpm --filter @nitejar/database db:migrate`,
    'Then restart the web server.',
    `Original error: ${message}`,
  ].join(' ')
}

export function logSchemaMismatchOnce(error: unknown, context: string): boolean {
  if (!isSchemaMismatchError(error)) return false

  const logMessage = formatSchemaMismatchMessage(error, context)
  if (!loggedMessages.has(logMessage)) {
    loggedMessages.add(logMessage)
    console.error(logMessage)
  }

  return true
}
