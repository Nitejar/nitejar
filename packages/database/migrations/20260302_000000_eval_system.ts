import { Kysely, sql } from 'kysely'

const isPostgres =
  (process.env.DATABASE_URL || '').startsWith('postgres://') ||
  (process.env.DATABASE_URL || '').startsWith('postgresql://')

const defaultTimestamp = isPostgres ? sql`extract(epoch from now())::integer` : sql`(unixepoch())`

export async function up(db: Kysely<unknown>): Promise<void> {
  // 1. rubrics
  await db.schema
    .createTable('rubrics')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('criteria_json', 'text', (col) => col.notNull())
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('judge_model', 'text')
    .addColumn('created_by', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  // 2. evaluators
  await db.schema
    .createTable('evaluators')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('type', 'text', (col) => col.notNull())
    .addColumn('config_json', 'text', (col) => col.notNull())
    .addColumn('judge_model', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  // 3. agent_evaluators
  await db.schema
    .createTable('agent_evaluators')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('agent_id', 'text', (col) =>
      col.notNull().references('agents.id').onDelete('cascade')
    )
    .addColumn('evaluator_id', 'text', (col) =>
      col.notNull().references('evaluators.id').onDelete('cascade')
    )
    .addColumn('weight', 'real', (col) => col.notNull().defaultTo(1.0))
    .addColumn('is_active', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('sample_rate', 'real')
    .addColumn('is_gate', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addUniqueConstraint('uq_agent_evaluators_agent_evaluator', ['agent_id', 'evaluator_id'])
    .execute()

  await db.schema
    .createIndex('idx_agent_evaluators_agent')
    .ifNotExists()
    .on('agent_evaluators')
    .column('agent_id')
    .execute()

  await db.schema
    .createIndex('idx_agent_evaluators_evaluator')
    .ifNotExists()
    .on('agent_evaluators')
    .column('evaluator_id')
    .execute()

  await db.schema
    .createIndex('idx_agent_evaluators_agent_active')
    .ifNotExists()
    .on('agent_evaluators')
    .columns(['agent_id', 'is_active'])
    .execute()

  // 4. eval_runs
  await db.schema
    .createTable('eval_runs')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('job_id', 'text', (col) => col.notNull().references('jobs.id').onDelete('cascade'))
    .addColumn('agent_id', 'text', (col) =>
      col.notNull().references('agents.id').onDelete('cascade')
    )
    .addColumn('work_item_id', 'text', (col) =>
      col.notNull().references('work_items.id').onDelete('cascade')
    )
    .addColumn('trigger', 'text', (col) => col.notNull().defaultTo('auto'))
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('pending'))
    .addColumn('overall_score', 'real')
    .addColumn('gates_passed', 'integer')
    .addColumn('pipeline_result_json', 'text')
    .addColumn('total_cost_usd', 'real', (col) => col.defaultTo(0))
    .addColumn('error_text', 'text')
    .addColumn('started_at', 'integer')
    .addColumn('completed_at', 'integer')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createIndex('idx_eval_runs_job')
    .ifNotExists()
    .on('eval_runs')
    .column('job_id')
    .execute()

  await db.schema
    .createIndex('idx_eval_runs_agent')
    .ifNotExists()
    .on('eval_runs')
    .column('agent_id')
    .execute()

  await db.schema
    .createIndex('idx_eval_runs_agent_created')
    .ifNotExists()
    .on('eval_runs')
    .columns(['agent_id', 'created_at'])
    .execute()

  await db.schema
    .createIndex('idx_eval_runs_status')
    .ifNotExists()
    .on('eval_runs')
    .column('status')
    .execute()

  // 5. eval_results
  await db.schema
    .createTable('eval_results')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('eval_run_id', 'text', (col) =>
      col.notNull().references('eval_runs.id').onDelete('cascade')
    )
    .addColumn('evaluator_id', 'text', (col) =>
      col.notNull().references('evaluators.id').onDelete('cascade')
    )
    .addColumn('result_type', 'text', (col) => col.notNull())
    .addColumn('score', 'real')
    .addColumn('passed', 'integer')
    .addColumn('details_json', 'text')
    .addColumn('evaluator_config_snapshot_json', 'text', (col) => col.notNull())
    .addColumn('cost_usd', 'real', (col) => col.defaultTo(0))
    .addColumn('duration_ms', 'integer')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  await db.schema
    .createIndex('idx_eval_results_run')
    .ifNotExists()
    .on('eval_results')
    .column('eval_run_id')
    .execute()

  await db.schema
    .createIndex('idx_eval_results_evaluator')
    .ifNotExists()
    .on('eval_results')
    .column('evaluator_id')
    .execute()

  // 6. eval_settings (singleton)
  await db.schema
    .createTable('eval_settings')
    .ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey().defaultTo('default'))
    .addColumn('judge_model', 'text')
    .addColumn('max_daily_evals', 'integer', (col) => col.notNull().defaultTo(50))
    .addColumn('sample_rate_default', 'real', (col) => col.notNull().defaultTo(1.0))
    .addColumn('sample_rate_high_volume_threshold', 'integer', (col) => col.notNull().defaultTo(20))
    .addColumn('sample_rate_high_volume', 'real', (col) => col.notNull().defaultTo(0.2))
    .addColumn('eval_cost_budget_usd', 'real')
    .addColumn('created_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .addColumn('updated_at', 'integer', (col) => col.notNull().defaultTo(defaultTimestamp))
    .execute()

  // Seed the singleton row
  await db
    .insertInto('eval_settings' as never)
    .values({ id: 'default' } as never)
    .onConflict((oc) => oc.column('id' as never).doNothing())
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_eval_results_evaluator').ifExists().execute()
  await db.schema.dropIndex('idx_eval_results_run').ifExists().execute()
  await db.schema.dropTable('eval_results').ifExists().execute()

  await db.schema.dropIndex('idx_eval_runs_status').ifExists().execute()
  await db.schema.dropIndex('idx_eval_runs_agent_created').ifExists().execute()
  await db.schema.dropIndex('idx_eval_runs_agent').ifExists().execute()
  await db.schema.dropIndex('idx_eval_runs_job').ifExists().execute()
  await db.schema.dropTable('eval_runs').ifExists().execute()

  await db.schema.dropIndex('idx_agent_evaluators_agent_active').ifExists().execute()
  await db.schema.dropIndex('idx_agent_evaluators_evaluator').ifExists().execute()
  await db.schema.dropIndex('idx_agent_evaluators_agent').ifExists().execute()
  await db.schema.dropTable('agent_evaluators').ifExists().execute()

  await db.schema.dropTable('evaluators').ifExists().execute()
  await db.schema.dropTable('rubrics').ifExists().execute()
  await db.schema.dropTable('eval_settings').ifExists().execute()
}
