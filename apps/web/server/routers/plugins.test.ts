import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@nitejar/database', () => ({
  acknowledgePluginDisclosures: vi.fn(),
  createPluginEvent: vi.fn(),
  ensurePluginDisclosureRows: vi.fn(),
  findPluginById: vi.fn(),
  findPluginInstancesByType: vi.fn(),
  listPluginEvents: vi.fn(),
  listPluginDisclosureAcks: vi.fn(),
  listPluginVersions: vi.fn(),
  listPlugins: vi.fn(),
  updatePlugin: vi.fn(),
  setPluginEnabled: vi.fn(),
  upsertPlugin: vi.fn(),
  upsertPluginVersion: vi.fn(),
}))

import {
  acknowledgePluginDisclosures,
  createPluginEvent,
  ensurePluginDisclosureRows,
  findPluginById,
  findPluginInstancesByType,
  listPluginEvents,
  listPluginDisclosureAcks,
  listPluginVersions,
  listPlugins,
  updatePlugin,
  setPluginEnabled,
  upsertPlugin,
  upsertPluginVersion,
} from '@nitejar/database'
import { pluginsRouter } from './plugins'

const mockedAcknowledgePluginDisclosures = vi.mocked(acknowledgePluginDisclosures)
const mockedCreatePluginEvent = vi.mocked(createPluginEvent)
const mockedEnsurePluginDisclosureRows = vi.mocked(ensurePluginDisclosureRows)
const mockedFindPluginById = vi.mocked(findPluginById)
const mockedFindPluginInstancesByType = vi.mocked(findPluginInstancesByType)
const mockedListPluginEvents = vi.mocked(listPluginEvents)
const mockedListPluginDisclosureAcks = vi.mocked(listPluginDisclosureAcks)
const mockedListPluginVersions = vi.mocked(listPluginVersions)
const mockedListPlugins = vi.mocked(listPlugins)
const mockedUpdatePlugin = vi.mocked(updatePlugin)
const mockedSetPluginEnabled = vi.mocked(setPluginEnabled)
const mockedUpsertPlugin = vi.mocked(upsertPlugin)
const mockedUpsertPluginVersion = vi.mocked(upsertPluginVersion)

const caller = pluginsRouter.createCaller({
  session: { user: { id: 'user-1' } } as never,
})

function makePlugin(
  manifestPermissions: Record<string, unknown> = { network: ['api.example.com'] }
) {
  return {
    id: 'com.acme.plugin',
    name: 'Acme Plugin',
    source_kind: 'npm',
    source_ref: '@acme/plugin',
    enabled: 0,
    trust_level: 'untrusted',
    current_version: '1.0.0',
    current_checksum: 'abc123',
    current_install_path: '/tmp/plugin',
    manifest_json: JSON.stringify({
      schemaVersion: 1,
      id: 'com.acme.plugin',
      name: 'Acme Plugin',
      version: '1.0.0',
      permissions: manifestPermissions,
    }),
    config_json: null,
    last_load_error: null,
    last_loaded_at: null,
    installed_at: 1700000000,
    updated_at: 1700000000,
  }
}

function lastEventDetail(kind?: string): Record<string, unknown> {
  const call = kind
    ? [...mockedCreatePluginEvent.mock.calls]
        .reverse()
        .find((entry) => (entry[0] as { kind?: string } | undefined)?.kind === kind)
    : mockedCreatePluginEvent.mock.calls.at(-1)
  const payload = call?.[0]
  expect(payload).toBeDefined()
  return JSON.parse(payload!.detail_json ?? '{}') as Record<string, unknown>
}

describe('plugins router contract', () => {
  const originalTrustMode = process.env.SLOPBOT_PLUGIN_TRUST_MODE

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.SLOPBOT_PLUGIN_TRUST_MODE

    mockedFindPluginInstancesByType.mockResolvedValue([])
    mockedCreatePluginEvent.mockResolvedValue({ id: 'event-1' } as never)
    mockedUpdatePlugin.mockResolvedValue(null as never)
    mockedUpsertPlugin.mockResolvedValue(makePlugin({}) as never)
    mockedUpsertPluginVersion.mockResolvedValue({ version: '1.0.0' } as never)
    mockedEnsurePluginDisclosureRows.mockResolvedValue(undefined)
    mockedAcknowledgePluginDisclosures.mockResolvedValue(undefined)
  })

  afterAll(() => {
    if (originalTrustMode === undefined) {
      delete process.env.SLOPBOT_PLUGIN_TRUST_MODE
      return
    }
    process.env.SLOPBOT_PLUGIN_TRUST_MODE = originalTrustMode
  })

  it('returns runtime metadata in runtimeInfo', async () => {
    const result = await caller.runtimeInfo()
    expect(result.executionMode).toBe('in_process')
    expect(result.trustMode).toBe('self_host_guarded')
  })

  it('returns runtime metadata in listPlugins responses', async () => {
    mockedListPlugins.mockResolvedValue([makePlugin()] as never)
    mockedListPluginDisclosureAcks.mockResolvedValue([
      {
        plugin_id: 'com.acme.plugin',
        permission: 'network',
        scope: 'api.example.com',
        acknowledged: 1,
        acknowledged_at: 1700000000,
      },
    ] as never)

    const result = await caller.listPlugins()
    expect(result.executionMode).toBe('in_process')
    expect(result.plugins[0]?.declaredCapabilityCount).toBe(1)
    expect(result.plugins[0]?.acknowledgedDisclosureCount).toBe(1)
  })

  it('rejects unknown builtin IDs in install flow', async () => {
    await expect(
      caller.installPlugin({
        pluginId: 'builtin.evil',
        name: 'Evil Builtin',
        sourceKind: 'builtin',
        version: '1.0.0',
        declaredCapabilities: [],
      })
    ).rejects.toThrow('Only platform builtin plugin IDs can use sourceKind "builtin"')

    expect(mockedUpsertPlugin).not.toHaveBeenCalled()
  })

  it('does not overwrite existing builtin acks during registration', async () => {
    mockedListPlugins.mockResolvedValue([] as never)
    mockedListPluginDisclosureAcks.mockResolvedValue([] as never)

    await caller.listPlugins()

    // Built-in disclosures should be batch-acknowledged, not individually set
    expect(mockedAcknowledgePluginDisclosures).toHaveBeenCalledWith('builtin.telegram')
    expect(mockedAcknowledgePluginDisclosures).toHaveBeenCalledWith('builtin.github')
  })

  it('returns runtime metadata and limitations in getPlugin responses', async () => {
    mockedFindPluginById.mockResolvedValue(makePlugin() as never)
    mockedListPluginDisclosureAcks.mockResolvedValue([] as never)
    mockedListPluginVersions.mockResolvedValue([] as never)
    mockedListPluginEvents.mockResolvedValue({ events: [], nextCursor: null } as never)

    const result = await caller.getPlugin({ pluginId: 'com.acme.plugin' })
    expect(result.executionMode).toBe('in_process')
    expect(result.effectiveLimitations.length).toBeGreaterThan(0)
  })

  it('allows enable with missing acks and records disclosure receipt', async () => {
    process.env.SLOPBOT_PLUGIN_TRUST_MODE = 'self_host_guarded'
    mockedFindPluginById.mockResolvedValue(makePlugin() as never)
    mockedListPluginDisclosureAcks.mockResolvedValue([] as never)
    mockedSetPluginEnabled.mockResolvedValue(makePlugin() as never)

    const result = await caller.enablePlugin({
      pluginId: 'com.acme.plugin',
      consentAccepted: true,
    })

    expect(result.ok).toBe(true)
    expect(mockedSetPluginEnabled).toHaveBeenCalledWith('com.acme.plugin', true)
    expect(mockedAcknowledgePluginDisclosures).toHaveBeenCalledWith('com.acme.plugin')
    expect(mockedCreatePluginEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        plugin_id: 'com.acme.plugin',
        kind: 'enable',
        status: 'ok',
      })
    )
    const detail = lastEventDetail('enable')
    expect(detail.disclosureAcknowledged).toBe(true)
    expect(Array.isArray(detail.unacknowledgedDisclosures)).toBe(true)
    expect((detail.unacknowledgedDisclosures as unknown[]).length).toBe(1)
    expect(detail.executionMode).toBe('in_process')
  })

  it('requires explicit consent before third-party enable', async () => {
    mockedFindPluginById.mockResolvedValue(makePlugin() as never)
    mockedListPluginDisclosureAcks.mockResolvedValue([
      {
        plugin_id: 'com.acme.plugin',
        permission: 'network',
        scope: 'api.example.com',
        acknowledged: 1,
        acknowledged_at: 1700000000,
      },
    ] as never)

    await expect(
      caller.enablePlugin({ pluginId: 'com.acme.plugin', consentAccepted: false })
    ).rejects.toThrow('Explicit consent is required')
    expect(mockedSetPluginEnabled).not.toHaveBeenCalled()
  })

  it('enables third-party plugin when acks and consent are present', async () => {
    mockedFindPluginById.mockResolvedValue(makePlugin() as never)
    mockedListPluginDisclosureAcks.mockResolvedValue([
      {
        plugin_id: 'com.acme.plugin',
        permission: 'network',
        scope: 'api.example.com',
        acknowledged: 1,
        acknowledged_at: 1700000000,
      },
    ] as never)
    mockedSetPluginEnabled.mockResolvedValue(makePlugin() as never)

    const result = await caller.enablePlugin({
      pluginId: 'com.acme.plugin',
      consentAccepted: true,
    })

    expect(result.ok).toBe(true)
    expect(result.executionMode).toBe('in_process')
    const detail = lastEventDetail('enable')
    expect(detail.consentAccepted).toBe(true)
  })

  it('blocks third-party enable in saas_locked and writes policy-gate receipt', async () => {
    process.env.SLOPBOT_PLUGIN_TRUST_MODE = 'saas_locked'
    mockedFindPluginById.mockResolvedValue(makePlugin() as never)

    await expect(
      caller.enablePlugin({ pluginId: 'com.acme.plugin', consentAccepted: true })
    ).rejects.toThrow('cannot be enabled in saas_locked mode')

    expect(mockedSetPluginEnabled).not.toHaveBeenCalled()
    const detail = lastEventDetail()
    expect(detail.reason).toBe('trust_mode_locked')
    expect(detail.executionMode).toBe('in_process')
  })
})
