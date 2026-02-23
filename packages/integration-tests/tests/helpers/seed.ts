import { randomUUID } from 'crypto'
import {
  createAgent,
  createIdempotencyKey,
  createPluginInstance,
  createWorkItem,
  type Agent,
  type IdempotencyKey,
  type PluginInstanceRecord,
  type NewAgent,
  type NewWorkItem,
  type WorkItem,
} from '@nitejar/database'

export async function seedPluginInstance(
  overrides: Partial<Parameters<typeof createPluginInstance>[0]> = {}
): Promise<PluginInstanceRecord> {
  return createPluginInstance({
    type: 'github',
    name: `Plugin Instance ${randomUUID()}`,
    config: null,
    scope: 'global',
    enabled: 1,
    ...overrides,
  })
}

/** @deprecated Use `seedPluginInstance`. */
export const seedIntegration = seedPluginInstance

export async function seedAgent(
  overrides: Partial<Omit<NewAgent, 'id' | 'created_at' | 'updated_at'>> = {}
): Promise<Agent> {
  const handle = `agent-${randomUUID().slice(0, 8)}`
  return createAgent({
    handle,
    name: `Agent ${randomUUID()}`,
    sprite_id: null,
    config: null,
    status: 'idle',
    ...overrides,
  })
}

export async function seedWorkItem(
  overrides: Partial<Omit<NewWorkItem, 'id' | 'created_at' | 'updated_at'>> = {}
): Promise<WorkItem> {
  return createWorkItem({
    plugin_instance_id: null,
    session_key: `session-${randomUUID()}`,
    source: 'test',
    source_ref: `ref-${randomUUID()}`,
    title: 'Test Work Item',
    payload: null,
    ...overrides,
  })
}

export async function seedIdempotencyKey(
  key: string,
  workItemId: string | null = null
): Promise<IdempotencyKey> {
  return createIdempotencyKey({
    key,
    work_item_id: workItemId,
  })
}
