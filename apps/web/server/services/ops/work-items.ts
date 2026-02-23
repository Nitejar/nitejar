import {
  findWorkItemById,
  getCostByWorkItems,
  listEffectOutboxByWorkItem,
  listJobsByWorkItem,
  listRunDispatchesByWorkItem,
  searchWorkItems,
} from '@nitejar/database'
import type { GetWorkItemInput, SearchWorkItemsInput } from '@/server/services/ops/schemas'
import { decodeCursor, encodeCursor } from './cursor'

export async function searchWorkItemsOp(input: SearchWorkItemsInput) {
  const cursor = decodeCursor(input.cursor)
  if (input.cursor && !cursor) {
    throw new Error('Invalid cursor')
  }

  const result = await searchWorkItems({
    q: input.q,
    statuses: input.statuses,
    sources: input.sources,
    pluginInstanceId: input.pluginInstanceId,
    agentId: input.agentId,
    sessionKeyPrefix: input.sessionKeyPrefix,
    createdAfter: input.createdAfter,
    createdBefore: input.createdBefore,
    limit: input.limit,
    cursor,
  })

  const costs = await getCostByWorkItems(result.items.map((item) => item.id))
  const costMap = new Map(costs.map((row) => [row.work_item_id, row]))

  return {
    items: result.items.map((item) => ({
      ...item,
      cost: costMap.get(item.id) ?? null,
    })),
    nextCursor: encodeCursor(result.nextCursor),
  }
}

export async function getWorkItemOp(input: GetWorkItemInput) {
  const workItem = await findWorkItemById(input.workItemId)
  if (!workItem) throw new Error('Work item not found')

  const costs = await getCostByWorkItems([workItem.id])
  const cost = costs[0] ?? null

  const [runs, dispatches, effects] = await Promise.all([
    input.includeRuns ? listJobsByWorkItem(workItem.id) : Promise.resolve(undefined),
    input.includeDispatches ? listRunDispatchesByWorkItem(workItem.id) : Promise.resolve(undefined),
    input.includeEffects ? listEffectOutboxByWorkItem(workItem.id) : Promise.resolve(undefined),
  ])

  return {
    workItem,
    cost,
    ...(runs ? { runs } : {}),
    ...(dispatches ? { dispatches } : {}),
    ...(effects ? { effects } : {}),
  }
}
