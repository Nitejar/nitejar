export const GITHUB_REPO_CAPABILITY_DESCRIPTORS = [
  {
    id: 'read_repo',
    label: 'read',
    hint: 'Read repository contents and metadata.',
    policyActions: ['github.repo.read'],
  },
  {
    id: 'create_branch',
    label: 'create branch',
    hint: 'Create new branches in the repository.',
    policyActions: ['github.repo.read', 'github.repo.create_branch'],
  },
  {
    id: 'push_branch',
    label: 'push',
    hint: 'Push commits to existing branches.',
    policyActions: ['github.repo.read', 'github.repo.push_branch'],
  },
  {
    id: 'open_pr',
    label: 'open PR',
    hint: 'Open pull requests.',
    policyActions: ['github.repo.read', 'github.repo.open_pr'],
  },
  {
    id: 'comment',
    label: 'comment',
    hint: 'Comment on issues and pull requests.',
    policyActions: ['github.repo.read', 'github.repo.comment'],
  },
  {
    id: 'request_review',
    label: 'request review',
    hint: 'Request pull request reviews.',
    policyActions: ['github.repo.read', 'github.repo.request_review'],
  },
  {
    id: 'label_issue_pr',
    label: 'labels',
    hint: 'Apply labels to issues and pull requests.',
    policyActions: ['github.repo.read', 'github.repo.label_issue_pr'],
  },
  {
    id: 'review_pr',
    label: 'review',
    hint: 'Submit pull request reviews.',
    policyActions: ['github.repo.read', 'github.repo.review_pr'],
  },
  {
    id: 'merge_pr',
    label: 'merge',
    hint: 'Merge approved pull requests.',
    policyActions: ['github.repo.read', 'github.repo.merge_pr'],
  },
] as const

export type GitHubRepoCapability = (typeof GITHUB_REPO_CAPABILITY_DESCRIPTORS)[number]['id']

export const GITHUB_REPO_CAPABILITY_IDS = GITHUB_REPO_CAPABILITY_DESCRIPTORS.map(
  (descriptor) => descriptor.id
) as [GitHubRepoCapability, ...GitHubRepoCapability[]]

const GITHUB_REPO_CAPABILITY_SET = new Set<string>(GITHUB_REPO_CAPABILITY_IDS)

export function isGitHubRepoCapability(value: string): value is GitHubRepoCapability {
  return GITHUB_REPO_CAPABILITY_SET.has(value)
}

export function parseGitHubRepoCapabilities(
  value: string | null | undefined
): GitHubRepoCapability[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return Array.from(
      new Set(
        parsed.filter(
          (item): item is GitHubRepoCapability =>
            typeof item === 'string' && isGitHubRepoCapability(item)
        )
      )
    ).sort()
  } catch {
    return []
  }
}

export function serializeGitHubRepoCapabilities(
  capabilities: Iterable<GitHubRepoCapability>
): string {
  const unique = Array.from(new Set(capabilities)).filter(isGitHubRepoCapability).sort()
  return JSON.stringify(unique)
}

export function getRequiredPolicyActionsForGitHubCapability(
  capability: GitHubRepoCapability
): string[] {
  const descriptor = GITHUB_REPO_CAPABILITY_DESCRIPTORS.find((entry) => entry.id === capability)
  return descriptor ? [...descriptor.policyActions] : ['github.repo.read']
}

export function filterGitHubRepoCapabilitiesByPolicy(params: {
  capabilities: Iterable<string>
  grantedActions: Iterable<string>
}): GitHubRepoCapability[] {
  const grantedActions = new Set(params.grantedActions)
  const hasWildcard = grantedActions.has('*')

  return Array.from(new Set(params.capabilities))
    .filter((capability): capability is GitHubRepoCapability => isGitHubRepoCapability(capability))
    .filter((capability) => {
      if (hasWildcard) return true
      return getRequiredPolicyActionsForGitHubCapability(capability).every((action) =>
        grantedActions.has(action)
      )
    })
    .sort()
}
