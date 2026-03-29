import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_EDIT_TOOL_MODE,
  DEFAULT_MODEL,
  getDefaultModel,
  getEditToolMode,
  getMemorySettings,
  getSessionSettings,
  mergeAgentConfig,
  parseAgentConfig,
  serializeAgentConfig,
} from './config'

describe('memory passive update settings', () => {
  afterEach(() => {
    delete process.env.AGENT_MODEL
  })

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

  it('ignores removed legacy capability flags in config JSON', () => {
    const config = parseAgentConfig(
      JSON.stringify({
        allowEphemeralSandboxCreation: true,
        allowRoutineManagement: true,
        dangerouslyUnrestricted: true,
      })
    )

    expect(config).toEqual({})
  })

  it('falls back to defaults when config JSON is invalid', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(parseAgentConfig('{not-json')).toEqual({})
    expect(warnSpy).toHaveBeenCalledWith(
      '[AgentConfig] Failed to parse config JSON, using defaults'
    )

    warnSpy.mockRestore()
  })

  it('parses valid config fields and drops invalid values', () => {
    const config = parseAgentConfig(
      JSON.stringify({
        systemPrompt: 'legacy system prompt',
        model: 'openrouter/test',
        temperature: 1.3,
        maxTokens: 1024,
        editToolMode: 'replace',
        title: 'Scout',
        emoji: 'owl',
        avatarUrl: 'https://example.com/avatar.png',
        soul: 'Be helpful',
        queue: {
          mode: 'steer',
          debounceMs: 12.7,
          maxQueued: 4.9,
        },
        memorySettings: {
          enabled: false,
          passiveUpdatesEnabled: true,
          maxMemories: 10.2,
          maxStoredMemories: 25.8,
          decayRate: 0.4,
          reinforceAmount: 0.5,
          similarityWeight: 0.6,
          minStrength: 0.7,
          extractionHint: `  ${'a'.repeat(2100)}  `,
        },
        sessionSettings: {
          enabled: false,
          maxTurns: 18.8,
          maxTokens: 3500,
          resetTriggers: ['/reset', 12, null],
          idleTimeoutMinutes: 45.6,
          dailyResetHour: 9.9,
          clearMemoriesOnReset: true,
          messageEmbeddings: false,
          compaction: {
            enabled: false,
            summaryMaxTokens: 250.2,
            extractMemories: true,
            loadPreviousSummary: false,
          },
        },
        triageSettings: {
          maxTokens: 900.2,
          reasoningEffort: 'high',
          recentHistoryMaxChars: 1200.8,
          recentHistoryLookbackMessages: 16.2,
          recentHistoryPerMessageMaxChars: 280.1,
        },
        exploreSettings: {
          model: '  gpt-5.4-mini  ',
        },
        networkPolicy: {
          mode: 'allow-list',
          presetId: 'preset-safe',
          customized: true,
          rules: [
            { domain: 'example.com', action: 'allow' },
            { domain: 'bad.test', action: 'deny' },
          ],
        },
      })
    )

    expect(config).toMatchObject({
      systemPrompt: 'legacy system prompt',
      model: 'openrouter/test',
      temperature: 1.3,
      maxTokens: 1024,
      editToolMode: 'replace',
      title: 'Scout',
      emoji: 'owl',
      avatarUrl: 'https://example.com/avatar.png',
      soul: 'Be helpful',
      queue: {
        mode: 'steer',
        debounceMs: 12,
        maxQueued: 4,
      },
      triageSettings: {
        maxTokens: 900,
        reasoningEffort: 'high',
        recentHistoryMaxChars: 1200,
        recentHistoryLookbackMessages: 16,
        recentHistoryPerMessageMaxChars: 280,
      },
      exploreSettings: {
        model: 'gpt-5.4-mini',
      },
      networkPolicy: {
        mode: 'allow-list',
        presetId: 'preset-safe',
        customized: true,
        rules: [
          { domain: 'example.com', action: 'allow' },
          { domain: 'bad.test', action: 'deny' },
        ],
      },
    })
    expect(config.memorySettings).toMatchObject({
      enabled: false,
      passiveUpdatesEnabled: true,
      maxMemories: 10,
      maxStoredMemories: 25,
      decayRate: 0.4,
      reinforceAmount: 0.5,
      similarityWeight: 0.6,
      minStrength: 0.7,
    })
    expect(config.memorySettings?.extractionHint).toHaveLength(1998)
    expect(config.sessionSettings).toMatchObject({
      enabled: false,
      maxTurns: 18,
      maxTokens: 3500,
      resetTriggers: ['/reset'],
      idleTimeoutMinutes: 45,
      dailyResetHour: 9,
      clearMemoriesOnReset: true,
      messageEmbeddings: false,
      compaction: {
        enabled: false,
        summaryMaxTokens: 250,
        extractMemories: true,
        loadPreviousSummary: false,
      },
    })
  })

  it('ignores invalid network policies and numeric bounds', () => {
    const config = parseAgentConfig(
      JSON.stringify({
        temperature: 3,
        maxTokens: 0,
        editToolMode: 'other',
        queue: {
          mode: 'panic',
          debounceMs: -1,
          maxQueued: 0,
        },
        memorySettings: {
          maxMemories: 0,
          maxStoredMemories: -1,
          decayRate: 2,
          reinforceAmount: -1,
          similarityWeight: 4,
          minStrength: -2,
        },
        sessionSettings: {
          maxTurns: 0,
          maxTokens: -1,
          idleTimeoutMinutes: 0,
          dailyResetHour: 24,
          resetTriggers: [null, 1],
          compaction: {
            summaryMaxTokens: 0,
          },
        },
        triageSettings: {
          maxTokens: 0,
          reasoningEffort: 'extreme',
          recentHistoryMaxChars: 0,
          recentHistoryLookbackMessages: -1,
          recentHistoryPerMessageMaxChars: 0,
        },
        exploreSettings: {
          model: '   ',
        },
        networkPolicy: {
          mode: 'allow-list',
          rules: [{ domain: 'example.com', action: 'maybe' }],
        },
      })
    )

    expect(config.temperature).toBeUndefined()
    expect(config.maxTokens).toBeUndefined()
    expect(config.editToolMode).toBeUndefined()
    expect(config.queue).toEqual({})
    expect(config.memorySettings).toEqual({})
    expect(config.sessionSettings).toEqual({
      resetTriggers: [],
      compaction: {},
    })
    expect(config.triageSettings).toEqual({})
    expect(config.exploreSettings).toEqual({})
    expect(config.networkPolicy).toBeUndefined()
  })

  it('provides session and edit defaults plus env-aware default model', () => {
    process.env.AGENT_MODEL = 'openrouter/override'

    expect(getDefaultModel()).toBe('openrouter/override')
    expect(getEditToolMode({})).toBe(DEFAULT_EDIT_TOOL_MODE)
    expect(getEditToolMode({ editToolMode: 'replace' })).toBe('replace')

    const settings = getSessionSettings({
      sessionSettings: {
        maxTurns: 8,
        compaction: {
          enabled: false,
        },
      },
    })

    expect(DEFAULT_MODEL).toBe('arcee-ai/trinity-large-preview:free')
    expect(settings.maxTurns).toBe(8)
    expect(settings.compaction.enabled).toBe(false)
    expect(settings.compaction.summaryMaxTokens).toBe(500)
  })

  it('serializes config and merges nested fields without dropping siblings', () => {
    const merged = mergeAgentConfig(
      {
        title: 'Scout',
        queue: {
          mode: 'collect',
          debounceMs: 5,
        },
        triageSettings: {
          maxTokens: 600,
        },
        sessionSettings: {
          maxTurns: 10,
          compaction: {
            enabled: true,
            loadPreviousSummary: true,
          },
        },
      },
      {
        title: '',
        queue: {
          maxQueued: 7,
        },
        triageSettings: {
          reasoningEffort: 'medium',
        },
        sessionSettings: {
          maxTokens: 4000,
          compaction: {
            extractMemories: true,
          },
        },
      }
    )

    expect(merged.title).toBeUndefined()
    expect(merged.queue).toEqual({
      mode: 'collect',
      debounceMs: 5,
      maxQueued: 7,
    })
    expect(merged.triageSettings).toEqual({
      maxTokens: 600,
      reasoningEffort: 'medium',
    })
    expect(merged.sessionSettings).toEqual({
      maxTurns: 10,
      maxTokens: 4000,
      compaction: {
        enabled: true,
        loadPreviousSummary: true,
        extractMemories: true,
      },
    })
    expect(JSON.parse(serializeAgentConfig(merged))).toMatchObject({
      queue: {
        maxQueued: 7,
      },
      sessionSettings: {
        maxTokens: 4000,
      },
    })
  })
})
