/**
 * Unified skill resolver — merges repo skills + DB skills + plugin skills
 * into a single index consumed by:
 * 1. Prompt-build time (skill summaries with sandbox paths)
 * 2. Tool-call time (use_skill lookup)
 * 3. Admin UI (full catalog with source attribution)
 */
import { getSkillAssignmentsForAgent, listSkillFiles, parseSkillJsonArray } from '@nitejar/database'
import type { SkillEntry } from './tools/types'

/** The well-known path on the sprite where DB/plugin skills are deployed */
const SANDBOX_SKILLS_ROOT = '/home/sprite/.skills'

/**
 * A resolved skill from any source, with enough information
 * for the prompt builder and use_skill tool.
 */
export interface ResolvedSkill {
  /** Stable lookup identifier. For DB skills, this is the slug. For repo skills, derived from directory name. */
  id: string
  name: string
  description: string
  source: 'repo' | 'db' | 'plugin'
  /** Source detail: file path for repo, skill DB id for db, plugin id for plugin */
  sourceRef: string
  /** Whether this skill is a directory with supporting files */
  isDirectory: boolean
  /** List of supporting files (relative paths) */
  supportingFiles?: Array<{
    relativePath: string
    contentType?: string
  }>
  /** Sandbox path where this skill lives (for DB/plugin skills synced to sandbox) */
  sandboxPath?: string
  /** Absolute path on sprite filesystem (repo skills -- from project tree, not .skills/) */
  absolutePath?: string
  /** Tags for filtering */
  tags: string[]
  /** Category for grouping */
  category: string
  /** Whether this skill is enabled */
  enabled: boolean
  /** Tools the skill expects the agent to have (advisory, not enforced) */
  requiresTools?: string[]
  /** Version from frontmatter or DB */
  version?: string
  /** Whether the skill description should be auto-injected into the system prompt */
  autoInject?: boolean
  /** Priority for ordering in the prompt */
  priority?: number
}

/**
 * Resolve all skills available to an agent.
 * Merges DB skills (admin + plugin), repo skills, and applies priority rules.
 *
 * Priority when slugs collide:
 * 1. DB skill (admin-created) overrides plugin skill with same slug
 * 2. Plugin skill overrides repo skill with same slug
 * 3. Repo skill is the lowest priority source
 */
export async function resolveSkillsForAgent(
  agentId: string,
  teamId?: string | null,
  repoSkills?: SkillEntry[]
): Promise<ResolvedSkill[]> {
  const skillMap = new Map<string, ResolvedSkill>()

  // 1. Add repo skills first (lowest priority)
  if (repoSkills) {
    for (const skill of repoSkills) {
      const slug = skill.name.toLowerCase().replace(/\s+/g, '-')
      skillMap.set(slug, {
        id: slug,
        name: skill.name,
        description: skill.description || '',
        source: 'repo',
        sourceRef: skill.absolutePath,
        isDirectory: false,
        absolutePath: skill.absolutePath,
        tags: [],
        category: 'general',
        enabled: true,
      })
    }
  }

  // 2. Load DB skill assignments (overrides repo skills with same slug)
  const assignments = await getSkillAssignmentsForAgent(agentId, teamId)

  for (const assignment of assignments) {
    const skill = assignment.skill
    const source: 'db' | 'plugin' = skill.source_kind === 'plugin' ? 'plugin' : 'db'

    // Only override if priority is higher (db > plugin > repo)
    const existing = skillMap.get(skill.slug)
    if (existing) {
      const sourcePriority = { repo: 0, plugin: 1, db: 2 }
      if (sourcePriority[source] <= sourcePriority[existing.source]) {
        continue
      }
    }

    // Load supporting files for directory skills
    let supportingFiles: Array<{ relativePath: string; contentType?: string }> | undefined
    if (skill.is_directory) {
      const files = await listSkillFiles(skill.id)
      supportingFiles = files.map((f) => ({
        relativePath: f.relative_path,
        contentType: f.content_type ?? undefined,
      }))
    }

    skillMap.set(skill.slug, {
      id: skill.slug,
      name: skill.name,
      description: skill.description || '',
      source,
      sourceRef: source === 'plugin' ? (skill.plugin_id ?? skill.id) : skill.id,
      isDirectory: skill.is_directory === 1,
      supportingFiles,
      sandboxPath: `${SANDBOX_SKILLS_ROOT}/${skill.slug}`,
      tags: parseSkillJsonArray(skill.tags_json),
      category: skill.category,
      enabled: skill.enabled === 1,
      requiresTools: parseSkillJsonArray(skill.requires_tools_json) || undefined,
      version: skill.version ?? undefined,
      autoInject: assignment.auto_inject === 1,
      priority: assignment.priority,
    })
  }

  // 3. Sort by priority (higher first), then by name
  const resolved = Array.from(skillMap.values())
  resolved.sort((a, b) => {
    const pa = a.priority ?? 0
    const pb = b.priority ?? 0
    if (pa !== pb) return pb - pa
    return a.name.localeCompare(b.name)
  })

  return resolved
}

/**
 * Resolve a single skill by slug for the use_skill tool.
 * Case-insensitive match against name or slug.
 */
export async function resolveSkillBySlug(
  slug: string,
  agentId: string,
  teamId?: string | null,
  repoSkills?: SkillEntry[]
): Promise<ResolvedSkill | null> {
  const all = await resolveSkillsForAgent(agentId, teamId, repoSkills)
  const lower = slug.toLowerCase()
  return all.find((s) => s.id.toLowerCase() === lower || s.name.toLowerCase() === lower) ?? null
}
