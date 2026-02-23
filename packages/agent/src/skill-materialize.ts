/**
 * Skill materialization — reads from DB and writes to host filesystem cache.
 *
 * DB (durable) -> Host filesystem (cache) -> Agent sandbox (deployment)
 *
 * The host filesystem at /app/data/skills/<skill-id>/ is a materialized cache
 * derived from DB rows. It can be blown away and reconstructed at any time.
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { findSkillById, listSkillFiles } from '@nitejar/database'

/**
 * Get the root skill cache directory.
 * Uses SLOPBOT_SKILL_DIR env var or defaults to data/skills/ relative to cwd.
 */
export function getSkillDir(): string {
  return process.env.SLOPBOT_SKILL_DIR || path.join(process.cwd(), 'data', 'skills')
}

/**
 * Get the path to a specific skill's cache directory.
 */
export function getSkillCacheDir(skillId: string): string {
  return path.join(getSkillDir(), skillId)
}

/**
 * Ensure a skill is materialized on the host filesystem.
 * Reads skills + skill_files rows from DB and writes to /data/skills/<id>/.
 * No-ops if the cache directory already exists and checksums match.
 *
 * @returns The path to the materialized skill directory.
 */
export async function materializeSkill(skillId: string): Promise<string> {
  const skill = await findSkillById(skillId)
  if (!skill) {
    throw new Error(`Skill not found: ${skillId}`)
  }

  const cacheDir = getSkillCacheDir(skillId)
  const skillMdPath = path.join(cacheDir, 'SKILL.md')

  // Check if already materialized with matching checksum
  try {
    const existing = await fs.readFile(skillMdPath, 'utf-8')
    const { createHash } = await import('node:crypto')
    const existingChecksum = createHash('sha256').update(existing).digest('hex')
    if (existingChecksum === skill.checksum) {
      return cacheDir
    }
  } catch {
    // Not cached or read failed — proceed to materialize
  }

  // Blow away any stale cache and recreate
  await fs.rm(cacheDir, { recursive: true, force: true })
  await fs.mkdir(cacheDir, { recursive: true })

  // Write SKILL.md from DB content
  await fs.writeFile(skillMdPath, skill.content, 'utf-8')

  // Write supporting files from skill_files table
  if (skill.is_directory) {
    const files = await listSkillFiles(skillId)
    for (const file of files) {
      const filePath = path.join(cacheDir, file.relative_path)
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, file.content, 'utf-8')
    }
  }

  return cacheDir
}

/**
 * Remove a skill's cache directory from the host filesystem.
 */
export async function removeMaterializedSkill(skillId: string): Promise<void> {
  const cacheDir = getSkillCacheDir(skillId)
  await fs.rm(cacheDir, { recursive: true, force: true })
}

/**
 * Invalidate and re-materialize a skill's cache.
 * Called when skill content is updated in the DB.
 */
export async function rematerializeSkill(skillId: string): Promise<string> {
  await removeMaterializedSkill(skillId)
  return materializeSkill(skillId)
}
