export type DomainPresetSummary = {
  id: string
  label: string
  hint: string
  domains: string[]
}

export const DOMAIN_PRESET_SUMMARIES: DomainPresetSummary[] = [
  {
    id: 'github-only',
    label: 'GitHub Only',
    hint: 'GitHub API and git operations only',
    domains: [
      'github.com',
      '*.github.com',
      'api.github.com',
      'raw.githubusercontent.com',
      '*.githubusercontent.com',
    ],
  },
  {
    id: 'development',
    label: 'Development',
    hint: 'GitHub + npm + PyPI + common dev tooling',
    domains: [
      'github.com',
      '*.github.com',
      'api.github.com',
      '*.githubusercontent.com',
      'registry.npmjs.org',
      '*.npmjs.org',
      'pypi.org',
      '*.pypi.org',
      'files.pythonhosted.org',
      'crates.io',
      '*.crates.io',
    ],
  },
]
