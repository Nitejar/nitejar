import { z } from 'zod'
import { ROUTINE_ENVELOPE_FIELDS, type RoutineEnvelopeField } from './envelope'

const ruleOperatorSchema = z.enum([
  'eq',
  'neq',
  'in',
  'contains',
  'gt',
  'gte',
  'lt',
  'lte',
  'exists',
  'matches',
])

type RuleOperator = z.infer<typeof ruleOperatorSchema>

export type RoutineRule =
  | { all: RoutineRule[] }
  | { any: RoutineRule[] }
  | { not: RoutineRule }
  | {
      field: string
      op: RuleOperator
      value?: unknown
    }

const basePredicateSchema = z
  .object({
    field: z.string().min(1),
    op: ruleOperatorSchema,
    value: z.unknown().optional(),
  })
  .strict()

const logicalAllSchema: z.ZodType<RoutineRule> = z.lazy(() =>
  z
    .object({
      all: z.array(routineRuleSchema).min(1),
    })
    .strict()
)

const logicalAnySchema: z.ZodType<RoutineRule> = z.lazy(() =>
  z
    .object({
      any: z.array(routineRuleSchema).min(1),
    })
    .strict()
)

const logicalNotSchema: z.ZodType<RoutineRule> = z.lazy(() =>
  z
    .object({
      not: routineRuleSchema,
    })
    .strict()
)

const routineRuleSchema: z.ZodType<RoutineRule> = z.lazy(() =>
  z.union([logicalAllSchema, logicalAnySchema, logicalNotSchema, basePredicateSchema])
)

const envelopeFieldSet = new Set<string>(ROUTINE_ENVELOPE_FIELDS)

function validateFieldPath(path: string, mode: 'envelope' | 'probe'): boolean {
  if (mode === 'envelope') {
    return envelopeFieldSet.has(path)
  }

  return /^[a-zA-Z0-9_.]+$/.test(path)
}

function validatePredicateShape(rule: { op: RuleOperator; value?: unknown }): boolean {
  switch (rule.op) {
    case 'exists':
      return true
    case 'in':
      return Array.isArray(rule.value)
    case 'matches':
      return typeof rule.value === 'string'
    default:
      return rule.value !== undefined
  }
}

function validateRuleNode(node: RoutineRule, mode: 'envelope' | 'probe'): void {
  if ('all' in node) {
    node.all.forEach((child) => validateRuleNode(child, mode))
    return
  }
  if ('any' in node) {
    node.any.forEach((child) => validateRuleNode(child, mode))
    return
  }
  if ('not' in node) {
    validateRuleNode(node.not, mode)
    return
  }

  if (!validateFieldPath(node.field, mode)) {
    throw new Error(`Unsupported rule field path: ${node.field}`)
  }
  if (!validatePredicateShape(node)) {
    throw new Error(`Invalid value for op=${node.op}`)
  }
}

export function parseRoutineRule(
  value: unknown,
  mode: 'envelope' | 'probe' = 'envelope'
): RoutineRule {
  const parsed = routineRuleSchema.parse(value)
  validateRuleNode(parsed, mode)
  return parsed
}

function getPathValue(input: unknown, path: string): unknown {
  const segments = path.split('.')
  let cursor: unknown = input

  for (const segment of segments) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
      return undefined
    }
    cursor = (cursor as Record<string, unknown>)[segment]
  }

  return cursor
}

function compareValues(left: unknown, right: unknown): number {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right
  }

  const leftStr = String(left)
  const rightStr = String(right)
  if (leftStr === rightStr) return 0
  return leftStr > rightStr ? 1 : -1
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  return JSON.stringify(left) === JSON.stringify(right)
}

function evaluatePredicate(actual: unknown, op: RuleOperator, expected: unknown): boolean {
  switch (op) {
    case 'eq':
      return valuesEqual(actual, expected)
    case 'neq':
      return !valuesEqual(actual, expected)
    case 'in':
      return Array.isArray(expected) ? expected.some((item) => valuesEqual(item, actual)) : false
    case 'contains':
      if (typeof actual === 'string') {
        return typeof expected === 'string' ? actual.includes(expected) : false
      }
      if (Array.isArray(actual)) {
        return actual.some((item) => valuesEqual(item, expected))
      }
      return false
    case 'gt':
      return compareValues(actual, expected) > 0
    case 'gte':
      return compareValues(actual, expected) >= 0
    case 'lt':
      return compareValues(actual, expected) < 0
    case 'lte':
      return compareValues(actual, expected) <= 0
    case 'exists':
      return actual !== undefined && actual !== null
    case 'matches':
      if (typeof expected !== 'string') return false
      if (typeof actual !== 'string') return false
      try {
        return new RegExp(expected).test(actual)
      } catch {
        return false
      }
    default:
      return false
  }
}

export function evaluateRoutineRule(rule: RoutineRule, input: unknown): boolean {
  if ('all' in rule) {
    return rule.all.every((child) => evaluateRoutineRule(child, input))
  }

  if ('any' in rule) {
    return rule.any.some((child) => evaluateRoutineRule(child, input))
  }

  if ('not' in rule) {
    return !evaluateRoutineRule(rule.not, input)
  }

  const actual = getPathValue(input, rule.field)
  return evaluatePredicate(actual, rule.op, rule.value)
}

export function getAlwaysTrueRuleForEnvelope(): RoutineRule {
  return {
    field: 'createdAt' satisfies RoutineEnvelopeField,
    op: 'exists',
  }
}

export function getAlwaysTrueRuleForProbe(): RoutineRule {
  return {
    field: 'probe',
    op: 'exists',
  }
}
