/**
 * OpenRouter trace metadata for PostHog generation labeling.
 * @see https://openrouter.ai/docs/guides/features/broadcast/posthog
 */
export interface OpenRouterTrace {
  generation_name: string
  trace_name?: string
}

/**
 * Build an OpenRouter `trace` object for labeling generations in PostHog.
 */
export function openRouterTrace(
  generationName: string,
  agentHandle?: string
): { trace: OpenRouterTrace } {
  return {
    trace: {
      generation_name: agentHandle ? `${agentHandle}/${generationName}` : generationName,
      trace_name: agentHandle ?? 'nitejar',
    },
  }
}
