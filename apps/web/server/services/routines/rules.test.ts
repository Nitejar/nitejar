import { describe, expect, it } from 'vitest'
import { evaluateRoutineRule, parseRoutineRule } from './rules'

describe('routine rules', () => {
  it('rejects non-envelope fields in envelope mode', () => {
    expect(() =>
      parseRoutineRule(
        {
          field: 'payload.type',
          op: 'eq',
          value: 'message',
        },
        'envelope'
      )
    ).toThrow('Unsupported rule field path')
  })

  it('evaluates logical all/any/not combinations', () => {
    const rule = parseRoutineRule(
      {
        all: [
          { field: 'eventType', op: 'eq', value: 'issue_comment' },
          {
            any: [
              { field: 'actorKind', op: 'eq', value: 'human' },
              { not: { field: 'actorHandle', op: 'matches', value: '^bot' } },
            ],
          },
        ],
      },
      'envelope'
    )

    const matched = evaluateRoutineRule(rule, {
      eventType: 'issue_comment',
      actorKind: 'human',
      actorHandle: 'alice',
    })

    const notMatched = evaluateRoutineRule(rule, {
      eventType: 'check_run',
      actorKind: 'system',
      actorHandle: 'bot-ci',
    })

    expect(matched).toBe(true)
    expect(notMatched).toBe(false)
  })

  it('supports dotted fields in probe mode', () => {
    const rule = parseRoutineRule(
      {
        field: 'stats.failureRate',
        op: 'gte',
        value: 0.35,
      },
      'probe'
    )

    expect(
      evaluateRoutineRule(rule, {
        stats: { failureRate: 0.41 },
      })
    ).toBe(true)

    expect(
      evaluateRoutineRule(rule, {
        stats: { failureRate: 0.2 },
      })
    ).toBe(false)
  })
})
