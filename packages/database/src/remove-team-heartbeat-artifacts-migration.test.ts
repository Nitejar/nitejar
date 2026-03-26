import { describe, expect, it, vi } from 'vitest'

import { up } from '../migrations/20260326_010000_remove_team_heartbeat_artifacts'

function createDeleteBuilder() {
  return {
    where: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue(undefined),
  }
}

function createMockDb() {
  const builders = new Map<string, ReturnType<typeof createDeleteBuilder>>()

  const db = {
    deleteFrom: vi.fn((table: string) => {
      const builder = createDeleteBuilder()
      builders.set(table, builder)
      return builder
    }),
  }

  return { db, builders }
}

describe('remove_team_heartbeat_artifacts migration', () => {
  it('deletes legacy team heartbeat artifacts across session-bound tables', async () => {
    const { db, builders } = createMockDb()

    await up(db as never)

    expect(db.deleteFrom).toHaveBeenCalledTimes(9)
    expect(db.deleteFrom).toHaveBeenCalledWith('scheduled_items')
    expect(db.deleteFrom).toHaveBeenCalledWith('agent_messages')
    expect(db.deleteFrom).toHaveBeenCalledWith('session_summaries')
    expect(db.deleteFrom).toHaveBeenCalledWith('sprite_sessions')
    expect(db.deleteFrom).toHaveBeenCalledWith('queue_lanes')
    expect(db.deleteFrom).toHaveBeenCalledWith('work_items')
    expect(db.deleteFrom).toHaveBeenCalledWith('app_sessions')
    expect(db.deleteFrom).toHaveBeenCalledWith('work_updates')
    expect(db.deleteFrom).toHaveBeenCalledWith('routines')

    for (const table of [
      'scheduled_items',
      'agent_messages',
      'session_summaries',
      'sprite_sessions',
      'queue_lanes',
      'work_items',
      'app_sessions',
    ]) {
      expect(builders.get(table)?.where).toHaveBeenCalledWith(
        'session_key',
        'like',
        'work:team:%:heartbeat'
      )
      expect(builders.get(table)?.execute).toHaveBeenCalled()
    }

    expect(builders.get('routines')?.where).toHaveBeenCalledWith(
      'target_session_key',
      'like',
      'work:team:%:heartbeat'
    )
    expect(builders.get('routines')?.execute).toHaveBeenCalled()
  })

  it('removes team-scoped heartbeat updates', async () => {
    const { db, builders } = createMockDb()

    await up(db as never)

    expect(db.deleteFrom).toHaveBeenCalledWith('work_updates')
    expect(builders.get('work_updates')?.where).toHaveBeenNthCalledWith(1, 'kind', '=', 'heartbeat')
    expect(builders.get('work_updates')?.where).toHaveBeenNthCalledWith(
      2,
      'team_id',
      'is not',
      null
    )
    expect(builders.get('work_updates')?.execute).toHaveBeenCalled()
  })
})
