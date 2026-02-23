export interface ChangelogEntry {
  version: string
  date: string
  title: string
  description: string
  tags: string[]
}

export const changelogEntries: ChangelogEntry[] = [
  {
    version: '0.3.0',
    date: '2026-02-20',
    title: 'Plugin architecture & Telegram support',
    description:
      'Agents now connect to external services through a plugin system. Telegram is the first supported channel — point an agent at a group chat and it joins the conversation. Every message, every inference call, every cost entry tracked in the receipts.',
    tags: ['feature', 'plugins'],
  },
  {
    version: '0.2.0',
    date: '2026-01-15',
    title: 'Session memory & agent persistence',
    description:
      'Agents remember context across sessions. Passive memory stores observations, active memory retrieves relevant context before each run. The receipts show exactly what the agent recalled and why.',
    tags: ['feature', 'agents'],
  },
  {
    version: '0.1.0',
    date: '2025-12-01',
    title: 'Initial release — the night shift begins',
    description:
      'First public release of Nitejar. Create agents, define tools, run jobs. Admin dashboard with real-time logs, cost tracking, and work item inspection. Self-hosted, Apache-2.0, no vendor lock-in.',
    tags: ['release'],
  },
]
