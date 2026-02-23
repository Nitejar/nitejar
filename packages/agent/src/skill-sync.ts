/**
 * Sandbox sync — syncs skill directories from host filesystem cache to agent sandboxes.
 *
 * DB (durable) -> Host filesystem (cache) -> Agent sandbox (deployment)
 *                                            ^^^^^^^^^^^^^^^^^^^^^^^^^
 *                                            This module handles this step.
 *
 * Skills are synced to /home/sprite/.skills/<slug>/ on the sprite filesystem.
 * Uses the slug (not the UUID) as the directory name for human-readable paths.
 */
import { getSkillAssignmentsForAgent, findSkillById, listSkillFiles } from '@nitejar/database'
import { writeFile, mkdir, remove, listDir } from '@nitejar/sprites'
import { materializeSkill } from './skill-materialize'

/** The well-known path on the sprite where skills are deployed */
const SANDBOX_SKILLS_ROOT = '/home/sprite/.skills'

/**
 * Sync all assigned skills to an agent's sandbox.
 * Called at assignment changes and sandbox creation.
 *
 * 1. Lists all skill assignments for the agent (including global and team-scoped).
 * 2. Lists all directories in /home/sprite/.skills/ on the sprite.
 * 3. Syncs directories for assigned skills that are missing or have stale checksums.
 * 4. Removes directories for skills that are no longer assigned.
 */
export async function syncSkillsToSandbox(
  agentId: string,
  spriteName: string,
  teamId?: string | null
): Promise<{ synced: string[]; removed: string[]; errors: string[] }> {
  const synced: string[] = []
  const removed: string[] = []
  const errors: string[] = []

  // Get all skill assignments for this agent
  const assignments = await getSkillAssignmentsForAgent(agentId, teamId)

  // Ensure the .skills directory exists
  try {
    await mkdir(spriteName, SANDBOX_SKILLS_ROOT)
  } catch {
    // May already exist
  }

  // Get existing skill directories on the sprite
  let existingSlugs: string[] = []
  try {
    existingSlugs = await listDir(spriteName, SANDBOX_SKILLS_ROOT)
  } catch {
    // Directory may not exist or be empty
  }

  // Build the set of expected slugs
  const expectedSlugs = new Set(assignments.map((a) => a.skill_slug))

  // Sync each assigned skill
  for (const assignment of assignments) {
    try {
      await syncSkillToSprite(assignment.skill_id, assignment.skill_slug, spriteName)
      synced.push(assignment.skill_slug)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      errors.push(`Failed to sync skill ${assignment.skill_slug}: ${msg}`)
    }
  }

  // Remove skill directories that are no longer assigned
  for (const slug of existingSlugs) {
    if (!expectedSlugs.has(slug)) {
      try {
        await removeSkillFromSprite(slug, spriteName)
        removed.push(slug)
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        errors.push(`Failed to remove skill ${slug}: ${msg}`)
      }
    }
  }

  return { synced, removed, errors }
}

/**
 * Sync a single skill directory to a sprite.
 * Materializes from DB to host filesystem if needed, then writes
 * SKILL.md + all supporting files to /home/sprite/.skills/<slug>/ on the sprite.
 */
export async function syncSkillToSprite(
  skillId: string,
  skillSlug: string,
  spriteName: string
): Promise<void> {
  // Ensure skill is materialized on host filesystem
  await materializeSkill(skillId)

  // Load skill content from DB (source of truth)
  const skill = await findSkillById(skillId)
  if (!skill) {
    throw new Error(`Skill not found: ${skillId}`)
  }

  const skillDir = `${SANDBOX_SKILLS_ROOT}/${skillSlug}`

  // Remove existing directory and recreate
  try {
    await remove(spriteName, skillDir, { recursive: true })
  } catch {
    // May not exist
  }

  await mkdir(spriteName, skillDir)

  // Write SKILL.md
  await writeFile(spriteName, `${skillDir}/SKILL.md`, skill.content)

  // Write supporting files
  if (skill.is_directory) {
    const files = await listSkillFiles(skillId)
    for (const file of files) {
      const filePath = `${skillDir}/${file.relative_path}`
      // Ensure parent directories exist
      const parentDir = filePath.substring(0, filePath.lastIndexOf('/'))
      if (parentDir !== skillDir) {
        await mkdir(spriteName, parentDir)
      }
      await writeFile(spriteName, filePath, file.content)
    }
  }
}

/**
 * Remove a skill directory from a sprite.
 */
export async function removeSkillFromSprite(skillSlug: string, spriteName: string): Promise<void> {
  const skillDir = `${SANDBOX_SKILLS_ROOT}/${skillSlug}`
  await remove(spriteName, skillDir, { recursive: true })
}

/**
 * List skill slugs currently deployed to a sprite's sandbox.
 */
export async function listSandboxSkills(spriteName: string): Promise<string[]> {
  try {
    return await listDir(spriteName, SANDBOX_SKILLS_ROOT)
  } catch {
    return []
  }
}
