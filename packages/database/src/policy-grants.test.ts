import { describe, expect, it } from 'vitest'
import { buildPolicyPermissionRows } from './policy-grants'

describe('buildPolicyPermissionRows', () => {
  it('includes eval permission rows', () => {
    const rows = buildPolicyPermissionRows()

    const evalsRow = rows.find((row) => row.resource === 'Evals')
    expect(evalsRow).toBeDefined()
    expect(evalsRow?.ops.map((op) => op.op)).toEqual(
      expect.arrayContaining(['read', 'write', 'run'])
    )

    const settingsRow = rows.find((row) => row.resource === 'Eval Settings')
    expect(settingsRow).toBeDefined()
    expect(settingsRow?.ops.map((op) => op.op)).toEqual(['write'])
  })
})
