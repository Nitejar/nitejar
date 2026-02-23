import { Kysely, sql } from 'kysely'

const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

const defaultTimestamp = isPostgres ? sql`extract(epoch from now())::integer` : sql`(unixepoch())`

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('queue_lanes')
    .ifNotExists()
    .addColumn('queue_key', 'text', (col) => col.primaryKey())
    .addColumn('session_key', 'text', (col) => col.notNull())
    .addColumn('agent_id', 'text', (col) =>
      col.notNull().references('agents.id').onDelete('cascade')
    )
    .addColumn('plugin_instance_id', 'text', (col) =>
      col.references('plugin_instances.id').onDelete('set null')
    )
    .addColumn('state', 'text', (col) => col.notNull().defaultTo('idle'))
    .addColumn('is_paused', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('debounce_until', 'integer')
    .addColumn('debounce_ms', 'integer', (col) => col.notNull().defaultTo(2000))
    .addColumn('max_queued', 'integer', (col) => col.notNull().defaultTo(10))
    .addColumn('active_dispatch_id', 'text')
    .addColumn('paused_reason', 'text')
    .addColumn('paused_by', 'text')
    .addColumn('paused_at', 'integer')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createTable('run_dispatches')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('run_key', 'text', (col) => col.notNull().unique())
    .addColumn('queue_key', 'text', (col) => col.notNull())
    .addColumn('work_item_id', 'text', (col) =>
      col.notNull().references('work_items.id').onDelete('cascade')
    )
    .addColumn('agent_id', 'text', (col) =>
      col.notNull().references('agents.id').onDelete('cascade')
    )
    .addColumn('plugin_instance_id', 'text', (col) =>
      col.references('plugin_instances.id').onDelete('set null')
    )
    .addColumn('session_key', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('queued'))
    .addColumn('control_state', 'text', (col) => col.notNull().defaultTo('normal'))
    .addColumn('control_reason', 'text')
    .addColumn('control_updated_at', 'integer')
    .addColumn('input_text', 'text', (col) => col.notNull())
    .addColumn('coalesced_text', 'text')
    .addColumn('sender_name', 'text')
    .addColumn('response_context', 'text')
    .addColumn('job_id', 'text', (col) => col.references('jobs.id').onDelete('set null'))
    .addColumn('attempt_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('claimed_by', 'text')
    .addColumn('lease_expires_at', 'integer')
    .addColumn('claimed_epoch', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('last_error', 'text')
    .addColumn('replay_of_dispatch_id', 'text', (col) =>
      col.references('run_dispatches.id').onDelete('set null')
    )
    .addColumn('merged_into_dispatch_id', 'text', (col) =>
      col.references('run_dispatches.id').onDelete('set null')
    )
    .addColumn('scheduled_at', 'integer', (col) => col.notNull())
    .addColumn('started_at', 'integer')
    .addColumn('finished_at', 'integer')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createTable('queue_messages')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('queue_key', 'text', (col) => col.notNull())
    .addColumn('work_item_id', 'text', (col) =>
      col.notNull().references('work_items.id').onDelete('cascade')
    )
    .addColumn('plugin_instance_id', 'text', (col) =>
      col.references('plugin_instances.id').onDelete('set null')
    )
    .addColumn('response_context', 'text')
    .addColumn('text', 'text', (col) => col.notNull())
    .addColumn('sender_name', 'text')
    .addColumn('arrived_at', 'integer', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('pending'))
    .addColumn('dispatch_id', 'text', (col) =>
      col.references('run_dispatches.id').onDelete('set null')
    )
    .addColumn('drop_reason', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createTable('effect_outbox')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('effect_key', 'text', (col) => col.notNull().unique())
    .addColumn('dispatch_id', 'text', (col) =>
      col.notNull().references('run_dispatches.id').onDelete('cascade')
    )
    .addColumn('plugin_instance_id', 'text', (col) =>
      col.notNull().references('plugin_instances.id').onDelete('cascade')
    )
    .addColumn('work_item_id', 'text', (col) =>
      col.notNull().references('work_items.id').onDelete('cascade')
    )
    .addColumn('job_id', 'text', (col) => col.references('jobs.id').onDelete('set null'))
    .addColumn('channel', 'text', (col) => col.notNull())
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('payload', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('pending'))
    .addColumn('retryable', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('attempt_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('next_attempt_at', 'integer')
    .addColumn('claimed_by', 'text')
    .addColumn('lease_expires_at', 'integer')
    .addColumn('claimed_epoch', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('provider_ref', 'text')
    .addColumn('last_error', 'text')
    .addColumn('unknown_reason', 'text')
    .addColumn('released_by', 'text')
    .addColumn('released_at', 'integer')
    .addColumn('sent_at', 'integer')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createTable('runtime_control')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('processing_enabled', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('pause_mode', 'text', (col) => col.notNull().defaultTo('soft'))
    .addColumn('pause_reason', 'text')
    .addColumn('paused_by', 'text')
    .addColumn('paused_at', 'integer')
    .addColumn('control_epoch', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db
    .insertInto('runtime_control')
    .values({
      id: 'default',
      processing_enabled: 1,
      pause_mode: 'soft',
      pause_reason: null,
      paused_by: null,
      paused_at: null,
      control_epoch: 0,
      updated_at: Math.floor(Date.now() / 1000),
    })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute()

  await db.schema
    .createIndex('idx_queue_lanes_claim')
    .ifNotExists()
    .on('queue_lanes')
    .columns(['state', 'is_paused', 'debounce_until', 'queue_key'])
    .execute()

  await db.schema
    .createIndex('idx_queue_messages_pending')
    .ifNotExists()
    .on('queue_messages')
    .columns(['queue_key', 'status', 'arrived_at', 'id'])
    .execute()

  await db.schema
    .createIndex('idx_run_dispatches_claim')
    .ifNotExists()
    .on('run_dispatches')
    .columns(['status', 'scheduled_at', 'id'])
    .execute()

  await db.schema
    .createIndex('idx_run_dispatches_queue_status')
    .ifNotExists()
    .on('run_dispatches')
    .columns(['queue_key', 'status', 'scheduled_at', 'id'])
    .execute()

  await db.schema
    .createIndex('idx_run_dispatches_job')
    .ifNotExists()
    .on('run_dispatches')
    .column('job_id')
    .execute()

  await db.schema
    .createIndex('idx_effect_outbox_claim')
    .ifNotExists()
    .on('effect_outbox')
    .columns(['status', 'next_attempt_at', 'created_at', 'id'])
    .execute()

  await db.schema
    .createIndex('idx_effect_outbox_dispatch')
    .ifNotExists()
    .on('effect_outbox')
    .column('dispatch_id')
    .execute()

  await db.schema
    .createIndex('idx_effect_outbox_work_item')
    .ifNotExists()
    .on('effect_outbox')
    .columns(['work_item_id', 'created_at'])
    .execute()
}
