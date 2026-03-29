import type { Job } from '@nitejar/database'

type JobWithParent = Pick<Job, 'id' | 'parent_job_id'>
type JobCostSummary = {
  job_id: string
  total_cost: number
  prompt_tokens: number
  completion_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  call_count: number
  passive_memory_cost: number
  external_cost: number
}

export type JobCostTotals = Omit<JobCostSummary, 'job_id'>

export interface JobCostRollup {
  direct: JobCostTotals
  descendants: JobCostTotals
  inclusive: JobCostTotals
  descendantRunCount: number
}

function emptyJobCostTotals(): JobCostTotals {
  return {
    total_cost: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    call_count: 0,
    passive_memory_cost: 0,
    external_cost: 0,
  }
}

function toTotals(summary?: JobCostSummary | null): JobCostTotals {
  if (!summary) return emptyJobCostTotals()
  return {
    total_cost: summary.total_cost,
    prompt_tokens: summary.prompt_tokens,
    completion_tokens: summary.completion_tokens,
    cache_read_tokens: summary.cache_read_tokens,
    cache_write_tokens: summary.cache_write_tokens,
    call_count: summary.call_count,
    passive_memory_cost: summary.passive_memory_cost,
    external_cost: summary.external_cost,
  }
}

function addTotals(left: JobCostTotals, right: JobCostTotals): JobCostTotals {
  return {
    total_cost: left.total_cost + right.total_cost,
    prompt_tokens: left.prompt_tokens + right.prompt_tokens,
    completion_tokens: left.completion_tokens + right.completion_tokens,
    cache_read_tokens: left.cache_read_tokens + right.cache_read_tokens,
    cache_write_tokens: left.cache_write_tokens + right.cache_write_tokens,
    call_count: left.call_count + right.call_count,
    passive_memory_cost: left.passive_memory_cost + right.passive_memory_cost,
    external_cost: left.external_cost + right.external_cost,
  }
}

export function toJobCostSummary(jobId: string, totals: JobCostTotals): JobCostSummary {
  return {
    job_id: jobId,
    total_cost: totals.total_cost,
    prompt_tokens: totals.prompt_tokens,
    completion_tokens: totals.completion_tokens,
    cache_read_tokens: totals.cache_read_tokens,
    cache_write_tokens: totals.cache_write_tokens,
    call_count: totals.call_count,
    passive_memory_cost: totals.passive_memory_cost,
    external_cost: totals.external_cost,
  }
}

export function buildJobCostRollups(
  jobs: JobWithParent[],
  costSummaries: JobCostSummary[]
): Map<string, JobCostRollup> {
  const directCostByJob = new Map(costSummaries.map((summary) => [summary.job_id, summary]))
  const childIdsByParent = new Map<string, string[]>()

  for (const job of jobs) {
    if (!job.parent_job_id) continue
    const childIds = childIdsByParent.get(job.parent_job_id) ?? []
    childIds.push(job.id)
    childIdsByParent.set(job.parent_job_id, childIds)
  }

  const memo = new Map<string, JobCostRollup>()

  const visit = (jobId: string): JobCostRollup => {
    const cached = memo.get(jobId)
    if (cached) return cached

    const direct = toTotals(directCostByJob.get(jobId) ?? null)
    let descendants = emptyJobCostTotals()
    let descendantRunCount = 0

    for (const childId of childIdsByParent.get(jobId) ?? []) {
      const childRollup = visit(childId)
      descendants = addTotals(descendants, childRollup.inclusive)
      descendantRunCount += 1 + childRollup.descendantRunCount
    }

    const rollup = {
      direct,
      descendants,
      inclusive: addTotals(direct, descendants),
      descendantRunCount,
    }
    memo.set(jobId, rollup)
    return rollup
  }

  for (const job of jobs) {
    visit(job.id)
  }

  return memo
}
