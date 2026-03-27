import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    UPDATE roles
    SET charter = CASE
      WHEN job_description IS NULL OR trim(job_description) = '' THEN charter
      WHEN charter IS NULL OR trim(charter) = '' THEN job_description
      ELSE charter || char(10) || char(10) || job_description
    END
    WHERE job_description IS NOT NULL AND trim(job_description) <> ''
  `.execute(db)

  await db.schema.alterTable('roles').dropColumn('job_description').execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('roles').addColumn('job_description', 'text').execute()
}
