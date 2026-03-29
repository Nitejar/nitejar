export type ChangesetRelease = {
  name?: string | undefined
  type?: string | undefined
  oldVersion?: string | undefined
  newVersion?: string | undefined
}

export type ChangesetStatus = {
  releases?: ChangesetRelease[] | undefined
}

export const repoRoot: string
export const generatedChangesetPath: string
export const runtimeReleaseExclusions: Set<string>

export function shouldSyncCliRelease(status: ChangesetStatus): boolean
export function buildSyntheticCliChangeset(): string
export function readChangesetStatus(): ChangesetStatus
export function ensureSyntheticCliChangeset(status: ChangesetStatus): boolean
export function cleanupVersionArtifacts(): void
export function runVersionPackages(): void
