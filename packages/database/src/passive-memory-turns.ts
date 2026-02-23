/**
 * Turn ranges reserved for passive-memory model calls in `inference_calls`.
 * These are synthetic markers for cost attribution and receipts partitioning.
 */
export const PASSIVE_MEMORY_EXTRACT_TURN_BASE = 10_000
export const PASSIVE_MEMORY_REFINE_TURN_BASE = 20_000

/** Any turn at or above this threshold is counted as passive-memory spend. */
export const PASSIVE_MEMORY_TURN_THRESHOLD = PASSIVE_MEMORY_EXTRACT_TURN_BASE
