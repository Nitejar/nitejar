import { sql, type Kysely } from 'kysely'
import { getDb } from '../db'
import type {
  Collection,
  CollectionPermission,
  CollectionRow,
  CollectionSchemaReview,
  CollectionUpdate,
  Database,
} from '../types'

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function uuid(): string {
  return crypto.randomUUID()
}

export const COLLECTION_FIELD_TYPES = [
  'string',
  'number',
  'boolean',
  'datetime',
  'enum',
  'longtext',
] as const

export type CollectionFieldType = (typeof COLLECTION_FIELD_TYPES)[number]

export interface CollectionFieldDefinition {
  name: string
  type: CollectionFieldType
  description?: string | null
  required?: boolean
  enumValues?: string[]
}

export interface CollectionSchemaDefinition {
  fields: CollectionFieldDefinition[]
}

export interface CollectionDefinition {
  id: string
  name: string
  description: string | null
  schema: CollectionSchemaDefinition
  schema_version: number
  created_by_agent_id: string | null
  created_at: number
  updated_at: number
}

export interface CollectionPermissionRecord {
  collection_id: string
  agent_id: string
  can_read: boolean
  can_write: boolean
  created_at: number
  updated_at: number
}

export type CollectionReviewAction = 'create' | 'update'
export type CollectionReviewStatus = 'pending' | 'approved' | 'rejected'

export interface CollectionSchemaReviewRecord {
  id: string
  collection_id: string | null
  collection_name: string
  action: CollectionReviewAction
  requested_by_agent_id: string
  proposed_description: string | null
  proposed_schema: CollectionSchemaDefinition
  status: CollectionReviewStatus
  reviewed_by_user_id: string | null
  review_notes: string | null
  created_at: number
  updated_at: number
  reviewed_at: number | null
  applied_at: number | null
}

export type CollectionValue = string | number | boolean | null

export interface CollectionRowRecord {
  id: string
  collection_id: string
  data: Record<string, CollectionValue>
  content: Record<string, CollectionValue>
  row: Record<string, CollectionValue>
  created_by_agent_id: string | null
  updated_by_agent_id: string | null
  created_at: number
  updated_at: number
}

export type CollectionFilterPrimitive = string | number | boolean | null

export interface CollectionFilterOperator {
  eq?: CollectionFilterPrimitive
  ne?: CollectionFilterPrimitive
  gt?: string | number
  gte?: string | number
  lt?: string | number
  lte?: string | number
  in?: CollectionFilterPrimitive[]
  contains?: string
}

export type CollectionFilterValue = CollectionFilterPrimitive | CollectionFilterOperator
export type CollectionFilter = Record<string, CollectionFilterValue>

export interface CollectionSortSpec {
  field: string
  direction?: 'asc' | 'desc'
}

export interface QueryCollectionRowsInput {
  collectionId: string
  filter?: CollectionFilter
  sort?: CollectionSortSpec
  limit?: number
  offset?: number
}

export interface SearchCollectionRowsInput {
  collectionId: string
  search: string
  filter?: CollectionFilter
  limit?: number
}

interface NormalizedCollectionFieldDefinition {
  name: string
  type: CollectionFieldType
  description: string | null
  required: boolean
  enumValues?: string[]
}

interface NormalizedCollectionSchemaDefinition {
  fields: NormalizedCollectionFieldDefinition[]
}

const FIELD_NAME_RE = /^[a-z][a-z0-9_]*$/
const COLLECTION_NAME_RE = /^[a-z][a-z0-9_]*$/
const FILTER_OPERATOR_KEYS = new Set(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'contains'])

type CollectionDb = Kysely<Database>

type CollectionSchemaInput =
  | CollectionSchemaDefinition
  | { fields: unknown }
  | Array<Record<string, unknown>>
  | Record<string, unknown>

function normalizeCollectionName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')

  if (!COLLECTION_NAME_RE.test(normalized)) {
    throw new Error(
      'Collection name must be snake_case (start with a letter, then letters, numbers, or underscores).'
    )
  }

  return normalized
}

function normalizeFieldName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')

  if (!FIELD_NAME_RE.test(normalized)) {
    throw new Error(
      `Invalid field name "${name}". Field names must be snake_case and start with a letter.`
    )
  }

  return normalized
}

function ensureCollectionFieldType(type: unknown, fieldName: string): CollectionFieldType {
  if (typeof type !== 'string') {
    throw new Error(`Field ${fieldName}: type is required.`)
  }

  if ((COLLECTION_FIELD_TYPES as readonly string[]).includes(type)) {
    return type as CollectionFieldType
  }

  throw new Error(
    `Field ${fieldName}: unsupported type "${type}". Supported types: ${COLLECTION_FIELD_TYPES.join(', ')}.`
  )
}

function parseEnumValues(input: unknown, fieldName: string): string[] | undefined {
  if (input === undefined || input === null) return undefined
  if (!Array.isArray(input)) {
    throw new Error(`Field ${fieldName}: enumValues must be an array of strings.`)
  }

  const values = input
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0)

  if (values.length === 0) {
    throw new Error(`Field ${fieldName}: enumValues must contain at least one value.`)
  }

  const unique = Array.from(new Set(values))
  return unique
}

function normalizeFieldDefinition(
  input: Record<string, unknown>
): NormalizedCollectionFieldDefinition {
  const rawName = typeof input.name === 'string' ? input.name : ''
  if (!rawName.trim()) {
    throw new Error('Each field must include a name.')
  }

  const name = normalizeFieldName(rawName)
  const type = ensureCollectionFieldType(input.type, name)
  const description =
    typeof input.description === 'string' ? input.description.trim() || null : null
  const required = input.required === true
  const enumInput = input.enumValues ?? input.enum_values ?? input.enum
  const enumValues = type === 'enum' ? parseEnumValues(enumInput, name) : undefined

  if (type === 'enum' && (!enumValues || enumValues.length === 0)) {
    throw new Error(`Field ${name}: enum fields require enumValues.`)
  }

  return {
    name,
    type,
    description,
    required,
    ...(enumValues ? { enumValues } : {}),
  }
}

function normalizeSchemaInput(input: CollectionSchemaInput): NormalizedCollectionSchemaDefinition {
  let rawFields: unknown

  if (Array.isArray(input)) {
    rawFields = input
  } else if (
    input &&
    typeof input === 'object' &&
    Array.isArray((input as { fields?: unknown }).fields)
  ) {
    rawFields = (input as { fields: unknown[] }).fields
  } else if (input && typeof input === 'object') {
    // Support map form: { title: { type: 'string' }, status: { type: 'enum', enum: [...] } }
    rawFields = Object.entries(input).map(([name, value]) => {
      if (typeof value === 'string') {
        return { name, type: value }
      }
      if (!value || typeof value !== 'object') {
        throw new Error(`Field ${name}: definition must be an object or type string.`)
      }
      return { name, ...(value as Record<string, unknown>) }
    })
  } else {
    throw new Error('Schema must be an object with fields or an array of field definitions.')
  }

  if (!Array.isArray(rawFields) || rawFields.length === 0) {
    throw new Error('Schema must include at least one field.')
  }

  const normalizedFields = rawFields.map((fieldInput) => {
    if (!fieldInput || typeof fieldInput !== 'object') {
      throw new Error('Each field definition must be an object.')
    }
    return normalizeFieldDefinition(fieldInput as Record<string, unknown>)
  })

  const seen = new Set<string>()
  for (const field of normalizedFields) {
    if (seen.has(field.name)) {
      throw new Error(`Duplicate field name: ${field.name}`)
    }
    seen.add(field.name)
  }

  normalizedFields.sort((a, b) => a.name.localeCompare(b.name))

  return { fields: normalizedFields }
}

function toPublicSchema(schema: NormalizedCollectionSchemaDefinition): CollectionSchemaDefinition {
  return {
    fields: schema.fields.map((field) => ({
      name: field.name,
      type: field.type,
      ...(field.description ? { description: field.description } : {}),
      ...(field.required ? { required: true } : {}),
      ...(field.enumValues ? { enumValues: [...field.enumValues] } : {}),
    })),
  }
}

function parseStoredSchema(schemaJson: string): NormalizedCollectionSchemaDefinition {
  const parsed: unknown = JSON.parse(schemaJson)
  return normalizeSchemaInput(parsed as CollectionSchemaInput)
}

function stableSchemaHash(schema: NormalizedCollectionSchemaDefinition): string {
  return JSON.stringify(schema)
}

function toCollectionDefinition(row: Collection): CollectionDefinition {
  const schema = parseStoredSchema(row.schema_json)
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    schema: toPublicSchema(schema),
    schema_version: row.schema_version,
    created_by_agent_id: row.created_by_agent_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function toCollectionPermissionRecord(row: CollectionPermission): CollectionPermissionRecord {
  return {
    collection_id: row.collection_id,
    agent_id: row.agent_id,
    can_read: row.can_read === 1,
    can_write: row.can_write === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function toCollectionSchemaReviewRecord(row: CollectionSchemaReview): CollectionSchemaReviewRecord {
  const schema = parseStoredSchema(row.proposed_schema_json)

  return {
    id: row.id,
    collection_id: row.collection_id,
    collection_name: row.collection_name,
    action: row.action as CollectionReviewAction,
    requested_by_agent_id: row.requested_by_agent_id,
    proposed_description: row.proposed_description,
    proposed_schema: toPublicSchema(schema),
    status: row.status as CollectionReviewStatus,
    reviewed_by_user_id: row.reviewed_by_user_id,
    review_notes: row.review_notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    reviewed_at: row.reviewed_at,
    applied_at: row.applied_at,
  }
}

function parseRowJson(raw: string | null | undefined): Record<string, CollectionValue> {
  if (!raw) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {}
  }

  const record = parsed as Record<string, unknown>
  const normalized: Record<string, CollectionValue> = {}
  for (const [key, value] of Object.entries(record)) {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      normalized[key] = value
    }
  }
  return normalized
}

function toCollectionRowRecord(row: CollectionRow): CollectionRowRecord {
  const data = parseRowJson(row.data_json)
  const content = parseRowJson(row.content_json)
  return {
    id: row.id,
    collection_id: row.collection_id,
    data,
    content,
    row: { ...data, ...content },
    created_by_agent_id: row.created_by_agent_id,
    updated_by_agent_id: row.updated_by_agent_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined
}

function normalizeFieldValue(
  field: NormalizedCollectionFieldDefinition,
  value: unknown,
  opts: { allowNull: boolean }
): CollectionValue {
  if (isNullish(value)) {
    if (!opts.allowNull) {
      throw new Error(`Field ${field.name} is required.`)
    }
    return null
  }

  switch (field.type) {
    case 'string':
    case 'longtext': {
      if (typeof value !== 'string') {
        throw new Error(`Field ${field.name} must be a string.`)
      }
      return value
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`Field ${field.name} must be a finite number.`)
      }
      return value
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        throw new Error(`Field ${field.name} must be a boolean.`)
      }
      return value
    }
    case 'datetime': {
      if (typeof value === 'number' && Number.isFinite(value)) {
        const millis = value > 10_000_000_000 ? value : value * 1000
        const date = new Date(millis)
        if (Number.isNaN(date.getTime())) {
          throw new Error(`Field ${field.name} must be a valid datetime.`)
        }
        return date.toISOString()
      }
      if (typeof value !== 'string') {
        throw new Error(`Field ${field.name} must be an ISO datetime string.`)
      }
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) {
        throw new Error(`Field ${field.name} must be a valid datetime.`)
      }
      return date.toISOString()
    }
    case 'enum': {
      if (typeof value !== 'string') {
        throw new Error(`Field ${field.name} must be one of the enum string values.`)
      }
      if (!field.enumValues || !field.enumValues.includes(value)) {
        throw new Error(
          `Field ${field.name} must be one of: ${(field.enumValues ?? []).join(', ')}`
        )
      }
      return value
    }
    default: {
      throw new Error(`Unsupported field type for ${field.name}.`)
    }
  }
}

function validateRowInput(
  schema: NormalizedCollectionSchemaDefinition,
  input: Record<string, unknown>,
  opts: { partial: boolean }
): Record<string, CollectionValue> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Row data must be an object.')
  }

  const fieldByName = new Map(schema.fields.map((field) => [field.name, field]))
  const normalized: Record<string, CollectionValue> = {}

  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = normalizeFieldName(rawKey)
    const field = fieldByName.get(key)
    if (!field) {
      throw new Error(`Unknown field: ${rawKey}`)
    }

    normalized[key] = normalizeFieldValue(field, rawValue, {
      allowNull: !field.required || opts.partial,
    })
  }

  if (!opts.partial) {
    for (const field of schema.fields) {
      if (!field.required) continue
      if (!Object.prototype.hasOwnProperty.call(normalized, field.name)) {
        throw new Error(`Missing required field: ${field.name}`)
      }
      if (normalized[field.name] === null) {
        throw new Error(`Field ${field.name} is required.`)
      }
    }
  }

  return normalized
}

function splitRowBySchema(
  schema: NormalizedCollectionSchemaDefinition,
  normalizedRow: Record<string, CollectionValue>
): { data: Record<string, CollectionValue>; content: Record<string, CollectionValue> } {
  const data: Record<string, CollectionValue> = {}
  const content: Record<string, CollectionValue> = {}

  const fieldByName = new Map(schema.fields.map((field) => [field.name, field]))
  for (const [key, value] of Object.entries(normalizedRow)) {
    const field = fieldByName.get(key)
    if (!field) continue

    if (field.type === 'longtext') {
      content[key] = value
    } else {
      data[key] = value
    }
  }

  return { data, content }
}

function buildSearchText(content: Record<string, CollectionValue>): string | null {
  const parts = Object.values(content)
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

  if (parts.length === 0) return null
  return parts.join('\n')
}

function getComparableValue(
  value: CollectionValue,
  field: NormalizedCollectionFieldDefinition | undefined
): string | number | boolean | null {
  if (value === null) return null
  if (!field) return value

  if (field.type === 'datetime' && typeof value === 'string') {
    const ts = Date.parse(value)
    return Number.isNaN(ts) ? value : ts
  }

  return value
}

function filterMatchesRow(
  row: CollectionRowRecord,
  schema: NormalizedCollectionSchemaDefinition,
  filter: CollectionFilter
): boolean {
  const fieldByName = new Map(schema.fields.map((field) => [field.name, field]))

  for (const [rawFieldName, filterValue] of Object.entries(filter)) {
    const fieldName = normalizeFieldName(rawFieldName)
    const field = fieldByName.get(fieldName)
    if (!field) {
      throw new Error(`Unknown filter field: ${rawFieldName}`)
    }

    const rowValue = row.row[fieldName] ?? null
    const comparableRow = getComparableValue(rowValue, field)

    if (
      filterValue === null ||
      typeof filterValue === 'string' ||
      typeof filterValue === 'number' ||
      typeof filterValue === 'boolean'
    ) {
      const normalized = normalizeFieldValue(field, filterValue, { allowNull: true })
      const comparableFilter = getComparableValue(normalized, field)
      if (comparableRow !== comparableFilter) return false
      continue
    }

    if (!filterValue || typeof filterValue !== 'object' || Array.isArray(filterValue)) {
      throw new Error(`Invalid filter for field ${fieldName}.`)
    }

    const operators: CollectionFilterOperator = filterValue
    for (const op of Object.keys(operators)) {
      if (!FILTER_OPERATOR_KEYS.has(op)) {
        throw new Error(`Unsupported filter operator: ${op}`)
      }
    }

    if (operators.eq !== undefined) {
      const normalized = normalizeFieldValue(field, operators.eq, { allowNull: true })
      if (comparableRow !== getComparableValue(normalized, field)) return false
    }

    if (operators.ne !== undefined) {
      const normalized = normalizeFieldValue(field, operators.ne, { allowNull: true })
      if (comparableRow === getComparableValue(normalized, field)) return false
    }

    if (operators.in !== undefined) {
      if (!Array.isArray(operators.in)) {
        throw new Error(`Filter operator "in" for ${fieldName} must be an array.`)
      }
      const values = operators.in.map((value) =>
        getComparableValue(normalizeFieldValue(field, value, { allowNull: true }), field)
      )
      if (!values.includes(comparableRow)) return false
    }

    if (operators.contains !== undefined) {
      if (typeof operators.contains !== 'string') {
        throw new Error(`Filter operator "contains" for ${fieldName} must be a string.`)
      }
      if (typeof rowValue !== 'string') return false
      if (!rowValue.toLowerCase().includes(operators.contains.toLowerCase())) return false
    }

    const compareOperators: Array<['gt' | 'gte' | 'lt' | 'lte', number]> = [
      ['gt', 1],
      ['gte', 2],
      ['lt', 3],
      ['lte', 4],
    ]

    for (const [operator, position] of compareOperators) {
      const compareValue = operators[operator]
      if (compareValue === undefined) continue

      const normalized = normalizeFieldValue(field, compareValue, { allowNull: true })
      const comparableFilter = getComparableValue(normalized, field)

      if (comparableRow === null || comparableFilter === null) return false
      if (typeof comparableRow !== typeof comparableFilter) return false

      if (position === 1 && !(comparableRow > comparableFilter)) return false
      if (position === 2 && !(comparableRow >= comparableFilter)) return false
      if (position === 3 && !(comparableRow < comparableFilter)) return false
      if (position === 4 && !(comparableRow <= comparableFilter)) return false
    }
  }

  return true
}

function sortRows(
  rows: CollectionRowRecord[],
  schema: NormalizedCollectionSchemaDefinition,
  sort?: CollectionSortSpec
): CollectionRowRecord[] {
  if (!sort) {
    return rows.sort((a, b) => b.updated_at - a.updated_at)
  }

  const fieldName = normalizeFieldName(sort.field)
  const direction: 'asc' | 'desc' = sort.direction === 'asc' ? 'asc' : 'desc'
  const field = schema.fields.find((candidate) => candidate.name === fieldName)
  if (!field) {
    throw new Error(`Unknown sort field: ${sort.field}`)
  }

  const factor = direction === 'asc' ? 1 : -1

  return rows.sort((a, b) => {
    const aValue = getComparableValue(a.row[fieldName] ?? null, field)
    const bValue = getComparableValue(b.row[fieldName] ?? null, field)

    if (aValue === bValue) {
      if (a.updated_at !== b.updated_at) return (a.updated_at - b.updated_at) * factor
      return a.id.localeCompare(b.id) * factor
    }

    if (aValue === null) return 1
    if (bValue === null) return -1

    if (typeof aValue === 'number' && typeof bValue === 'number') {
      return (aValue - bValue) * factor
    }

    if (typeof aValue === 'boolean' && typeof bValue === 'boolean') {
      return (Number(aValue) - Number(bValue)) * factor
    }

    return String(aValue).localeCompare(String(bValue)) * factor
  })
}

function stripLongtextFromRow(
  row: CollectionRowRecord,
  schema: CollectionSchemaDefinition
): Record<string, CollectionValue> {
  const longtextFields = new Set(
    schema.fields.filter((field) => field.type === 'longtext').map((field) => field.name)
  )

  const values: Record<string, CollectionValue> = {}
  for (const [key, value] of Object.entries(row.row)) {
    if (longtextFields.has(key)) continue
    values[key] = value
  }

  return values
}

function tokenizeSearch(search: string): string[] {
  return search
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
}

function scoreSearch(text: string, terms: string[]): number {
  const haystack = text.toLowerCase()
  let score = 0
  for (const term of terms) {
    if (!term) continue
    if (haystack.includes(term)) score += 1
  }
  return score
}

async function findCollectionByNameWithDb(
  db: CollectionDb,
  name: string
): Promise<Collection | null> {
  const normalized = normalizeCollectionName(name)
  const row = await db
    .selectFrom('collections')
    .selectAll()
    .where('name', '=', normalized)
    .executeTakeFirst()

  return row ?? null
}

async function findCollectionByIdWithDb(db: CollectionDb, id: string): Promise<Collection | null> {
  const row = await db.selectFrom('collections').selectAll().where('id', '=', id).executeTakeFirst()
  return row ?? null
}

async function upsertPermissionWithDb(
  db: CollectionDb,
  params: { collectionId: string; agentId: string; canRead: boolean; canWrite: boolean }
): Promise<void> {
  const timestamp = now()
  const canRead = params.canWrite ? true : params.canRead

  await db
    .insertInto('collection_permissions')
    .values({
      collection_id: params.collectionId,
      agent_id: params.agentId,
      can_read: canRead ? 1 : 0,
      can_write: params.canWrite ? 1 : 0,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .onConflict((oc) =>
      oc.columns(['collection_id', 'agent_id']).doUpdateSet({
        can_read: canRead ? 1 : 0,
        can_write: params.canWrite ? 1 : 0,
        updated_at: timestamp,
      })
    )
    .execute()
}

export async function findCollectionByName(name: string): Promise<CollectionDefinition | null> {
  const db = getDb()
  const row = await findCollectionByNameWithDb(db, name)
  return row ? toCollectionDefinition(row) : null
}

export async function findCollectionById(id: string): Promise<CollectionDefinition | null> {
  const db = getDb()
  const row = await findCollectionByIdWithDb(db, id)
  return row ? toCollectionDefinition(row) : null
}

export async function listCollections(): Promise<CollectionDefinition[]> {
  const db = getDb()
  const rows = await db.selectFrom('collections').selectAll().orderBy('name', 'asc').execute()
  return rows.map(toCollectionDefinition)
}

export async function listCollectionPermissions(
  collectionId: string
): Promise<CollectionPermissionRecord[]> {
  const db = getDb()
  const rows = await db
    .selectFrom('collection_permissions')
    .selectAll()
    .where('collection_id', '=', collectionId)
    .orderBy('agent_id', 'asc')
    .execute()

  return rows.map(toCollectionPermissionRecord)
}

export async function setCollectionPermission(params: {
  collectionId: string
  agentId: string
  canRead: boolean
  canWrite: boolean
}): Promise<CollectionPermissionRecord> {
  const db = getDb()
  await upsertPermissionWithDb(db, params)

  const row = await db
    .selectFrom('collection_permissions')
    .selectAll()
    .where('collection_id', '=', params.collectionId)
    .where('agent_id', '=', params.agentId)
    .executeTakeFirstOrThrow()

  return toCollectionPermissionRecord(row)
}

export async function removeCollectionPermission(
  collectionId: string,
  agentId: string
): Promise<boolean> {
  const db = getDb()
  const result = await db
    .deleteFrom('collection_permissions')
    .where('collection_id', '=', collectionId)
    .where('agent_id', '=', agentId)
    .executeTakeFirst()

  return (result.numDeletedRows ?? 0n) > 0n
}

export async function canAgentReadCollection(
  collectionId: string,
  agentId: string
): Promise<boolean> {
  const db = getDb()

  const permission = await db
    .selectFrom('collection_permissions')
    .select(['can_read', 'can_write'])
    .where('collection_id', '=', collectionId)
    .where('agent_id', '=', agentId)
    .executeTakeFirst()

  if (permission) {
    return permission.can_read === 1 || permission.can_write === 1
  }

  const anyPermission = await db
    .selectFrom('collection_permissions')
    .select('agent_id')
    .where('collection_id', '=', collectionId)
    .executeTakeFirst()

  // Backwards-compatible fallback: if no ACL entries exist yet, keep the collection open.
  return !anyPermission
}

export async function canAgentWriteCollection(
  collectionId: string,
  agentId: string
): Promise<boolean> {
  const db = getDb()

  const permission = await db
    .selectFrom('collection_permissions')
    .select(['can_write'])
    .where('collection_id', '=', collectionId)
    .where('agent_id', '=', agentId)
    .executeTakeFirst()

  if (permission) {
    return permission.can_write === 1
  }

  const anyPermission = await db
    .selectFrom('collection_permissions')
    .select('agent_id')
    .where('collection_id', '=', collectionId)
    .executeTakeFirst()

  // Backwards-compatible fallback: if no ACL entries exist yet, keep the collection open.
  return !anyPermission
}

export interface RequestCollectionSchemaReviewResult {
  status: 'pending' | 'already_pending' | 'noop'
  action: CollectionReviewAction
  collection: CollectionDefinition | null
  review: CollectionSchemaReviewRecord | null
}

export async function requestCollectionSchemaReview(params: {
  name: string
  description?: string | null
  schema: CollectionSchemaInput
  requestedByAgentId: string
}): Promise<RequestCollectionSchemaReviewResult> {
  const db = getDb()
  const collectionName = normalizeCollectionName(params.name)
  const description =
    typeof params.description === 'string' ? params.description.trim() || null : null
  const normalizedSchema = normalizeSchemaInput(params.schema)
  const schemaJson = JSON.stringify(toPublicSchema(normalizedSchema))

  const existing = await findCollectionByNameWithDb(db, collectionName)
  const action: CollectionReviewAction = existing ? 'update' : 'create'

  if (existing) {
    const currentSchema = parseStoredSchema(existing.schema_json)
    const sameSchema = stableSchemaHash(currentSchema) === stableSchemaHash(normalizedSchema)
    const sameDescription = (existing.description ?? null) === description

    if (sameSchema && sameDescription) {
      return {
        status: 'noop',
        action,
        collection: toCollectionDefinition(existing),
        review: null,
      }
    }
  }

  const existingPending = await db
    .selectFrom('collection_schema_reviews')
    .selectAll()
    .where('collection_name', '=', collectionName)
    .where('status', '=', 'pending')
    .orderBy('created_at', 'desc')
    .executeTakeFirst()

  if (existingPending) {
    return {
      status: 'already_pending',
      action,
      collection: existing ? toCollectionDefinition(existing) : null,
      review: toCollectionSchemaReviewRecord(existingPending),
    }
  }

  const timestamp = now()
  const review = await db
    .insertInto('collection_schema_reviews')
    .values({
      id: uuid(),
      collection_id: existing?.id ?? null,
      collection_name: collectionName,
      action,
      requested_by_agent_id: params.requestedByAgentId,
      proposed_description: description,
      proposed_schema_json: schemaJson,
      status: 'pending',
      reviewed_by_user_id: null,
      review_notes: null,
      created_at: timestamp,
      updated_at: timestamp,
      reviewed_at: null,
      applied_at: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  return {
    status: 'pending',
    action,
    collection: existing ? toCollectionDefinition(existing) : null,
    review: toCollectionSchemaReviewRecord(review),
  }
}

export async function listCollectionSchemaReviews(opts?: {
  status?: CollectionReviewStatus
  collectionId?: string
  limit?: number
}): Promise<CollectionSchemaReviewRecord[]> {
  const db = getDb()
  const limit = Math.min(Math.max(opts?.limit ?? 200, 1), 500)

  const rows = await db
    .selectFrom('collection_schema_reviews')
    .selectAll()
    .$if(!!opts?.status, (qb) => qb.where('status', '=', opts!.status!))
    .$if(!!opts?.collectionId, (qb) => qb.where('collection_id', '=', opts!.collectionId!))
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute()

  return rows.map(toCollectionSchemaReviewRecord)
}

export async function getCollectionSchemaReviewById(
  reviewId: string
): Promise<CollectionSchemaReviewRecord | null> {
  const db = getDb()
  const row = await db
    .selectFrom('collection_schema_reviews')
    .selectAll()
    .where('id', '=', reviewId)
    .executeTakeFirst()

  return row ? toCollectionSchemaReviewRecord(row) : null
}

export async function approveCollectionSchemaReview(params: {
  reviewId: string
  reviewerUserId: string
  notes?: string | null
}): Promise<{ review: CollectionSchemaReviewRecord; collection: CollectionDefinition }> {
  const db = getDb()

  return db.transaction().execute(async (trx) => {
    const reviewRow = await trx
      .selectFrom('collection_schema_reviews')
      .selectAll()
      .where('id', '=', params.reviewId)
      .executeTakeFirstOrThrow()

    if (reviewRow.status !== 'pending') {
      throw new Error(`Review ${params.reviewId} is already ${reviewRow.status}.`)
    }

    const proposedSchema = parseStoredSchema(reviewRow.proposed_schema_json)
    const nowTs = now()

    let collection = reviewRow.collection_id
      ? await findCollectionByIdWithDb(trx, reviewRow.collection_id)
      : await findCollectionByNameWithDb(trx, reviewRow.collection_name)

    if (reviewRow.action === 'create') {
      if (!collection) {
        collection = await trx
          .insertInto('collections')
          .values({
            id: uuid(),
            name: reviewRow.collection_name,
            description: reviewRow.proposed_description,
            schema_json: JSON.stringify(toPublicSchema(proposedSchema)),
            schema_version: 1,
            created_by_agent_id: reviewRow.requested_by_agent_id,
            created_at: nowTs,
            updated_at: nowTs,
          })
          .returningAll()
          .executeTakeFirstOrThrow()
      } else {
        collection = await trx
          .updateTable('collections')
          .set({
            description: reviewRow.proposed_description,
            schema_json: JSON.stringify(toPublicSchema(proposedSchema)),
            schema_version: collection.schema_version + 1,
            updated_at: nowTs,
          })
          .where('id', '=', collection.id)
          .returningAll()
          .executeTakeFirstOrThrow()
      }
    } else {
      if (!collection) {
        throw new Error(`Collection ${reviewRow.collection_name} not found for schema update.`)
      }

      collection = await trx
        .updateTable('collections')
        .set({
          description: reviewRow.proposed_description,
          schema_json: JSON.stringify(toPublicSchema(proposedSchema)),
          schema_version: collection.schema_version + 1,
          updated_at: nowTs,
        })
        .where('id', '=', collection.id)
        .returningAll()
        .executeTakeFirstOrThrow()
    }

    await upsertPermissionWithDb(trx, {
      collectionId: collection.id,
      agentId: reviewRow.requested_by_agent_id,
      canRead: true,
      canWrite: true,
    })

    const review = await trx
      .updateTable('collection_schema_reviews')
      .set({
        collection_id: collection.id,
        status: 'approved',
        reviewed_by_user_id: params.reviewerUserId,
        review_notes: params.notes?.trim() || null,
        reviewed_at: nowTs,
        applied_at: nowTs,
        updated_at: nowTs,
      })
      .where('id', '=', params.reviewId)
      .returningAll()
      .executeTakeFirstOrThrow()

    return {
      review: toCollectionSchemaReviewRecord(review),
      collection: toCollectionDefinition(collection),
    }
  })
}

export async function rejectCollectionSchemaReview(params: {
  reviewId: string
  reviewerUserId: string
  notes?: string | null
}): Promise<CollectionSchemaReviewRecord> {
  const db = getDb()
  const nowTs = now()

  const review = await db
    .updateTable('collection_schema_reviews')
    .set({
      status: 'rejected',
      reviewed_by_user_id: params.reviewerUserId,
      review_notes: params.notes?.trim() || null,
      reviewed_at: nowTs,
      applied_at: null,
      updated_at: nowTs,
    })
    .where('id', '=', params.reviewId)
    .where('status', '=', 'pending')
    .returningAll()
    .executeTakeFirst()

  if (!review) {
    const existing = await db
      .selectFrom('collection_schema_reviews')
      .select('status')
      .where('id', '=', params.reviewId)
      .executeTakeFirst()

    if (!existing) {
      throw new Error(`Review ${params.reviewId} not found.`)
    }

    throw new Error(`Review ${params.reviewId} is already ${existing.status}.`)
  }

  return toCollectionSchemaReviewRecord(review)
}

export async function updateCollectionSchema(params: {
  collectionId: string
  schema: CollectionSchemaInput
  description?: string | null
  name?: string
}): Promise<CollectionDefinition> {
  const db = getDb()
  const collection = await findCollectionByIdWithDb(db, params.collectionId)
  if (!collection) {
    throw new Error('Collection not found.')
  }

  const schema = normalizeSchemaInput(params.schema)
  const nextName = params.name ? normalizeCollectionName(params.name) : collection.name

  const updated = await db
    .updateTable('collections')
    .set({
      name: nextName,
      description:
        params.description !== undefined
          ? typeof params.description === 'string'
            ? params.description.trim() || null
            : null
          : collection.description,
      schema_json: JSON.stringify(toPublicSchema(schema)),
      schema_version: collection.schema_version + 1,
      updated_at: now(),
    } as CollectionUpdate)
    .where('id', '=', params.collectionId)
    .returningAll()
    .executeTakeFirstOrThrow()

  return toCollectionDefinition(updated)
}

async function listCollectionRowsByCollectionId(
  db: CollectionDb,
  collectionId: string
): Promise<CollectionRowRecord[]> {
  const rows = await db
    .selectFrom('collection_rows')
    .selectAll()
    .where('collection_id', '=', collectionId)
    .execute()

  return rows.map(toCollectionRowRecord)
}

export async function getCollectionRowById(
  collectionId: string,
  rowId: string
): Promise<CollectionRowRecord | null> {
  const db = getDb()
  const row = await db
    .selectFrom('collection_rows')
    .selectAll()
    .where('collection_id', '=', collectionId)
    .where('id', '=', rowId)
    .executeTakeFirst()

  return row ? toCollectionRowRecord(row) : null
}

export async function insertCollectionRow(params: {
  collectionId: string
  data: Record<string, unknown>
  agentId?: string
}): Promise<CollectionRowRecord> {
  const db = getDb()
  const collection = await findCollectionByIdWithDb(db, params.collectionId)
  if (!collection) {
    throw new Error('Collection not found.')
  }

  const schema = parseStoredSchema(collection.schema_json)
  const normalized = validateRowInput(schema, params.data, { partial: false })
  const { data, content } = splitRowBySchema(schema, normalized)
  const timestamp = now()

  const row = await db
    .insertInto('collection_rows')
    .values({
      id: uuid(),
      collection_id: params.collectionId,
      data_json: JSON.stringify(data),
      content_json: Object.keys(content).length > 0 ? JSON.stringify(content) : null,
      search_text: buildSearchText(content),
      created_by_agent_id: params.agentId ?? null,
      updated_by_agent_id: params.agentId ?? null,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  return toCollectionRowRecord(row)
}

export async function upsertCollectionRow(params: {
  collectionId: string
  match: Record<string, unknown>
  data: Record<string, unknown>
  agentId?: string
}): Promise<{ action: 'inserted' | 'updated'; row: CollectionRowRecord }> {
  const db = getDb()
  const collection = await findCollectionByIdWithDb(db, params.collectionId)
  if (!collection) {
    throw new Error('Collection not found.')
  }

  const schema = parseStoredSchema(collection.schema_json)
  const normalizedMatch = validateRowInput(schema, params.match, { partial: true })
  const normalizedData = validateRowInput(schema, params.data, { partial: true })

  if (Object.keys(normalizedMatch).length === 0) {
    throw new Error('match must include at least one field.')
  }

  const rows = await listCollectionRowsByCollectionId(db, params.collectionId)
  const matchedRow = rows.find((row) =>
    Object.entries(normalizedMatch).every(([field, value]) => row.row[field] === value)
  )

  if (!matchedRow) {
    const row = await insertCollectionRow({
      collectionId: params.collectionId,
      data: { ...normalizedMatch, ...normalizedData },
      agentId: params.agentId,
    })

    return { action: 'inserted', row }
  }

  const merged = { ...matchedRow.row, ...normalizedData }
  const validatedMerged = validateRowInput(schema, merged, { partial: false })
  const split = splitRowBySchema(schema, validatedMerged)
  const timestamp = now()

  const updatedRow = await db
    .updateTable('collection_rows')
    .set({
      data_json: JSON.stringify(split.data),
      content_json: Object.keys(split.content).length > 0 ? JSON.stringify(split.content) : null,
      search_text: buildSearchText(split.content),
      updated_by_agent_id: params.agentId ?? null,
      updated_at: timestamp,
    })
    .where('id', '=', matchedRow.id)
    .where('collection_id', '=', params.collectionId)
    .returningAll()
    .executeTakeFirstOrThrow()

  return { action: 'updated', row: toCollectionRowRecord(updatedRow) }
}

export async function queryCollectionRows(
  params: QueryCollectionRowsInput
): Promise<CollectionRowRecord[]> {
  const db = getDb()
  const collection = await findCollectionByIdWithDb(db, params.collectionId)
  if (!collection) {
    throw new Error('Collection not found.')
  }

  const schema = parseStoredSchema(collection.schema_json)
  const rows = await listCollectionRowsByCollectionId(db, params.collectionId)

  const filtered = params.filter
    ? rows.filter((row) => filterMatchesRow(row, schema, params.filter!))
    : rows

  const sorted = sortRows(filtered, schema, params.sort)
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 200)
  const offset = Math.max(params.offset ?? 0, 0)

  return sorted.slice(offset, offset + limit)
}

export async function searchCollectionRows(
  params: SearchCollectionRowsInput
): Promise<Array<CollectionRowRecord & { score: number }>> {
  const db = getDb()
  const collection = await findCollectionByIdWithDb(db, params.collectionId)
  if (!collection) {
    throw new Error('Collection not found.')
  }

  const schema = parseStoredSchema(collection.schema_json)
  const terms = tokenizeSearch(params.search)
  if (terms.length === 0) return []

  let query = db
    .selectFrom('collection_rows')
    .selectAll()
    .where('collection_id', '=', params.collectionId)

  for (const term of terms) {
    const pattern = `%${term}%`
    query = query.where(sql<boolean>`lower(coalesce(search_text, '')) like ${pattern}`)
  }

  const candidateRows = await query.orderBy('updated_at', 'desc').limit(1000).execute()
  const parsedRows = candidateRows.map(toCollectionRowRecord)

  const filtered = params.filter
    ? parsedRows.filter((row) => filterMatchesRow(row, schema, params.filter!))
    : parsedRows

  const scored = filtered
    .map((row) => {
      const text = buildSearchText(row.content) ?? ''
      return { ...row, score: scoreSearch(text, terms) }
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return b.updated_at - a.updated_at
    })

  const limit = Math.min(Math.max(params.limit ?? 20, 1), 200)
  return scored.slice(0, limit)
}

export async function listCollectionsWithSummary(): Promise<
  Array<
    CollectionDefinition & {
      rowCount: number
      permissionCount: number
      pendingReviewCount: number
    }
  >
> {
  const db = getDb()
  const collections = await db
    .selectFrom('collections')
    .selectAll()
    .orderBy('name', 'asc')
    .execute()

  const rowCounts = await db
    .selectFrom('collection_rows')
    .select(['collection_id', sql<number>`count(*)`.as('count')])
    .groupBy('collection_id')
    .execute()

  const permissionCounts = await db
    .selectFrom('collection_permissions')
    .select(['collection_id', sql<number>`count(*)`.as('count')])
    .groupBy('collection_id')
    .execute()

  const pendingReviewCounts = await db
    .selectFrom('collection_schema_reviews')
    .select(['collection_name', sql<number>`count(*)`.as('count')])
    .where('status', '=', 'pending')
    .groupBy('collection_name')
    .execute()

  const rowsByCollection = new Map(
    rowCounts.map((item) => [item.collection_id, Number(item.count)])
  )
  const permissionsByCollection = new Map(
    permissionCounts.map((item) => [item.collection_id, Number(item.count)])
  )
  const pendingByName = new Map(
    pendingReviewCounts.map((item) => [item.collection_name, Number(item.count)])
  )

  return collections.map((collection) => ({
    ...toCollectionDefinition(collection),
    rowCount: rowsByCollection.get(collection.id) ?? 0,
    permissionCount: permissionsByCollection.get(collection.id) ?? 0,
    pendingReviewCount: pendingByName.get(collection.name) ?? 0,
  }))
}

export async function countCollectionRows(collectionId: string): Promise<number> {
  const db = getDb()
  const result = await db
    .selectFrom('collection_rows')
    .select(sql<number>`count(*)`.as('count'))
    .where('collection_id', '=', collectionId)
    .executeTakeFirstOrThrow()

  return Number(result.count)
}

export async function getCollectionByNameOrThrow(name: string): Promise<CollectionDefinition> {
  const collection = await findCollectionByName(name)
  if (!collection) {
    throw new Error(`Collection ${name} not found.`)
  }
  return collection
}

export function projectCollectionRow(
  row: CollectionRowRecord,
  schema: CollectionSchemaDefinition,
  opts?: { includeContent?: boolean }
): {
  id: string
  created_at: number
  updated_at: number
  values: Record<string, CollectionValue>
} {
  const values = opts?.includeContent ? row.row : stripLongtextFromRow(row, schema)

  return {
    id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    values,
  }
}
