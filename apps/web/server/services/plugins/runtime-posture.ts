export type PluginTrustMode = 'self_host_open' | 'self_host_guarded' | 'saas_locked'
export type PluginExecutionMode = 'in_process'

export interface PluginRuntimePosture {
  trustMode: PluginTrustMode
  executionMode: PluginExecutionMode
  effectiveLimitations: string[]
  runtimeBadgeLabel: string
}

export function resolvePluginTrustMode(
  rawMode = process.env.SLOPBOT_PLUGIN_TRUST_MODE
): PluginTrustMode {
  if (
    rawMode === 'self_host_open' ||
    rawMode === 'self_host_guarded' ||
    rawMode === 'saas_locked'
  ) {
    return rawMode
  }
  return 'self_host_guarded'
}

export function getPluginRuntimePosture(mode = resolvePluginTrustMode()): PluginRuntimePosture {
  const executionMode: PluginExecutionMode = 'in_process'

  const effectiveLimitations =
    mode === 'self_host_open'
      ? [
          'Declared disclosures are operator acknowledgement controls in this mode.',
          'Plugin code runs in-process and is not hard sandbox-enforced.',
          'Direct plugin code paths outside host APIs may bypass these controls.',
        ]
      : [
          'Disclosure checks are enforced at host-managed API boundaries only.',
          'Plugin code still runs in-process and is not fully isolated.',
          'Direct plugin code paths outside host APIs are outside full enforcement.',
        ]

  return {
    trustMode: mode,
    executionMode,
    effectiveLimitations,
    runtimeBadgeLabel: 'In-process (No hard sandbox)',
  }
}
