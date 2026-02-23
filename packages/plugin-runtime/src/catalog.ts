import type { IntegrationCategory } from '@nitejar/plugin-handlers'

/**
 * A catalog entry describes a known/recommended plugin that can be installed.
 * The admin UI shows these alongside installed plugins.
 */
export interface CatalogEntry {
  /** Handler type identifier (e.g., 'discord') */
  type: string
  /** npm package name (e.g., '@nitejar/plugin-discord') */
  npmPackage: string
  /** Human-readable name */
  displayName: string
  /** Brief description */
  description: string
  /** Tabler icon name */
  icon: string
  /** Category for catalog grouping */
  category: IntegrationCategory
  /** Whether this is maintained by the nitejar team */
  official: boolean
}

/**
 * Static catalog of known/recommended plugins.
 * Community plugins can submit PRs to add their entries here.
 */
export const PLUGIN_CATALOG: CatalogEntry[] = [
  // Populated as official/community plugins are published
]
