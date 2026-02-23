export function agentLog(message: string, meta?: Record<string, unknown>): void {
  const prefix = `[${new Date().toISOString()}] [Agent] ${message}`
  if (meta) {
    console.log(prefix, meta)
    return
  }
  console.log(prefix)
}

export function agentWarn(message: string, meta?: Record<string, unknown>): void {
  const prefix = `[${new Date().toISOString()}] [Agent] ${message}`
  if (meta) {
    console.warn(prefix, meta)
    return
  }
  console.warn(prefix)
}

export function agentError(message: string, error?: unknown, meta?: Record<string, unknown>): void {
  const prefix = `[${new Date().toISOString()}] [Agent] ${message}`
  if (meta) {
    console.error(prefix, meta, error)
    return
  }
  if (error !== undefined) {
    console.error(prefix, error)
    return
  }
  console.error(prefix)
}
