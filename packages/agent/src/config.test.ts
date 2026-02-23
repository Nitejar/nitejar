import { describe, expect, it } from 'vitest'
import { getMemorySettings, mergeAgentConfig, parseAgentConfig } from './config'

describe('memory passive update settings', () => {
  it('defaults passive updates to false when unset', () => {
    const config = parseAgentConfig(null)
    const settings = getMemorySettings(config)
    expect(settings.passiveUpdatesEnabled).toBe(false)
  })

  it('parses explicit passiveUpdatesEnabled from memorySettings', () => {
    const config = parseAgentConfig(
      JSON.stringify({
        memorySettings: {
          passiveUpdatesEnabled: true,
        },
      })
    )
    const settings = getMemorySettings(config)
    expect(settings.passiveUpdatesEnabled).toBe(true)
  })

  it('uses legacy session compaction.extractMemories toggle when passive flag is unset', () => {
    const config = parseAgentConfig(
      JSON.stringify({
        sessionSettings: {
          compaction: {
            extractMemories: true,
          },
        },
      })
    )

    const settings = getMemorySettings(config)
    expect(settings.passiveUpdatesEnabled).toBe(true)
  })

  it('prefers explicit passiveUpdatesEnabled over legacy compaction.extractMemories', () => {
    const config = parseAgentConfig(
      JSON.stringify({
        memorySettings: {
          passiveUpdatesEnabled: false,
        },
        sessionSettings: {
          compaction: {
            extractMemories: true,
          },
        },
      })
    )

    const settings = getMemorySettings(config)
    expect(settings.passiveUpdatesEnabled).toBe(false)
  })

  it('merges passive updates field through mergeAgentConfig', () => {
    const existing = parseAgentConfig(
      JSON.stringify({
        memorySettings: {
          enabled: true,
          maxMemories: 15,
        },
      })
    )

    const merged = mergeAgentConfig(existing, {
      memorySettings: {
        passiveUpdatesEnabled: true,
      },
    })

    expect(merged.memorySettings?.enabled).toBe(true)
    expect(merged.memorySettings?.maxMemories).toBe(15)
    expect(merged.memorySettings?.passiveUpdatesEnabled).toBe(true)
  })

  it('parses dangerouslyUnrestricted boolean from config JSON', () => {
    const config = parseAgentConfig(
      JSON.stringify({
        dangerouslyUnrestricted: true,
      })
    )

    expect(config.dangerouslyUnrestricted).toBe(true)
  })

  it('merges dangerouslyUnrestricted through mergeAgentConfig', () => {
    const existing = parseAgentConfig(
      JSON.stringify({
        allowRoutineManagement: false,
      })
    )

    const merged = mergeAgentConfig(existing, {
      dangerouslyUnrestricted: true,
    })

    expect(merged.allowRoutineManagement).toBe(false)
    expect(merged.dangerouslyUnrestricted).toBe(true)
  })
})
