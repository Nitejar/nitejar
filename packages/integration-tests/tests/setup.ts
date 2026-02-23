import { beforeAll, beforeEach, afterAll } from 'vitest'
import { setupTestDb, resetTestDb, teardownTestDb } from './helpers/db'

beforeAll(async () => {
  await setupTestDb()
})

beforeEach(async () => {
  await resetTestDb()
})

afterAll(async () => {
  await teardownTestDb()
})
