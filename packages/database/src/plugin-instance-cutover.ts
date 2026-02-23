export const PLUGIN_INSTANCE_CUTOVER_MARKER_TABLE = 'plugin_instance_cutover_state'
export const PLUGIN_INSTANCE_CUTOVER_MARKER_ID = 'integrations_to_plugin_instances'

export const PLUGIN_INSTANCE_CUTOVER_STATUS = {
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const

export type PluginInstanceCutoverStatus =
  (typeof PLUGIN_INSTANCE_CUTOVER_STATUS)[keyof typeof PLUGIN_INSTANCE_CUTOVER_STATUS]
