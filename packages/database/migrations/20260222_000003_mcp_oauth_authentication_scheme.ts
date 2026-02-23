import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table oauth_application
    add column authentication_scheme text not null default 'client_secret_basic'
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table oauth_application
    drop column authentication_scheme
  `.execute(db)
}
