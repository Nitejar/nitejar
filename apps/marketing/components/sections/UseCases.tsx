'use client'

import { SectionHeading } from '@/components/shared/SectionHeading'

const scenarios = [
  // Dev & ops
  { emoji: '🐛', text: 'Triage new GitHub issues overnight' },
  { emoji: '🔍', text: 'Review PRs and flag security concerns' },
  { emoji: '🚨', text: 'Monitor error logs, open tickets for spikes' },
  { emoji: '🧪', text: 'Run test suites on every push, summarize failures' },
  { emoji: '📦', text: 'Check dependency updates, draft upgrade PRs' },
  { emoji: '🏗️', text: 'Scaffold boilerplate from a spec doc' },
  { emoji: '🔒', text: 'Audit repos for leaked secrets and credentials' },
  { emoji: '📋', text: 'Turn Slack threads into structured Jira tickets' },

  // Content & writing
  { emoji: '📝', text: 'Draft blog posts from a bullet-point outline' },
  { emoji: '🌐', text: 'Translate docs into 6 languages nightly' },
  { emoji: '📰', text: 'Curate an industry news digest every morning' },
  { emoji: '✍️', text: 'Rewrite release notes for a non-technical audience' },
  { emoji: '📚', text: 'Generate API docs from source code changes' },
  { emoji: '🎯', text: 'Write ad copy variants and rank them by clarity' },

  // Research & analysis
  { emoji: '🔬', text: 'Research competitors and summarize pricing changes' },
  { emoji: '📊', text: 'Pull analytics, write a weekly performance narrative' },
  { emoji: '🗺️', text: 'Map a new market and produce a brief' },
  { emoji: '📈', text: 'Track KPIs across tools, flag anomalies' },
  { emoji: '🧠', text: 'Summarize 50-page PDFs into 3-paragraph briefs' },
  { emoji: '💡', text: 'Score inbound leads based on fit criteria' },

  // Operations & comms
  { emoji: '📬', text: 'Send a Monday standup digest to Telegram' },
  { emoji: '🤝', text: 'Onboard new team members with a custom welcome flow' },
  { emoji: '📅', text: "Prep meeting agendas from last week's action items" },
  { emoji: '💰', text: 'Reconcile invoices against purchase orders' },
  { emoji: '🎧', text: 'Categorize support tickets by urgency and topic' },
  {
    emoji: '📣',
    text: 'Post changelog updates to Discord and Twitter',
    href: 'https://discord.gg/9Dh4QaQ4',
  },
  { emoji: '🔄', text: 'Sync CRM contacts with email lists nightly' },
  { emoji: '⏰', text: 'Remind the team about stale PRs older than 3 days' },

  // Multi-agent collaboration
  { emoji: '🤝', text: 'Two agents triage the same issue, one defers automatically' },
  {
    emoji: '🔥',
    text: 'Bug report hits Telegram — SRE agent diagnoses, writer agent drafts the postmortem',
  },
  { emoji: '🔬', text: 'Research agent gathers data, writer agent turns it into a report' },
]

// Split into two rows for opposite-direction scrolling
const row1 = scenarios.slice(0, Math.ceil(scenarios.length / 2))
const row2 = scenarios.slice(Math.ceil(scenarios.length / 2))

type Scenario = (typeof scenarios)[number]

function TickerRow({
  items,
  direction = 'left',
  duration = 60,
}: {
  items: Scenario[]
  direction?: 'left' | 'right'
  duration?: number
}) {
  // Double the items for seamless loop
  const doubled = [...items, ...items]

  return (
    <div className="group relative overflow-hidden">
      {/* Fade edges */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-night-950 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-night-950 to-transparent" />

      <div
        className="flex w-max gap-3 group-hover:[animation-play-state:paused]"
        style={{
          animation: `ticker-${direction} ${duration}s linear infinite`,
        }}
      >
        {doubled.map((item, i) => (
          <div
            key={`${item.text}-${i}`}
            className="flex shrink-0 items-center gap-2.5 rounded-lg border border-night-700/50 bg-night-900/80 px-4 py-2.5"
          >
            <span className="text-base">{item.emoji}</span>
            {item.href ? (
              <a
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className="whitespace-nowrap text-sm text-moon-200 underline decoration-gold-500/40 underline-offset-4 transition-colors hover:text-gold-400"
              >
                {item.text}
              </a>
            ) : (
              <span className="whitespace-nowrap text-sm text-moon-200">{item.text}</span>
            )}
          </div>
        ))}
      </div>

      <style jsx>{`
        @keyframes ticker-left {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(-50%);
          }
        }
        @keyframes ticker-right {
          from {
            transform: translateX(-50%);
          }
          to {
            transform: translateX(0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .flex {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  )
}

export function UseCases() {
  return (
    <section id="use-cases" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading
          eyebrow="Use cases"
          title="What your fleet does while you're away"
          description="Triage, draft, research, summarize, sync, alert. You name the workflow — your agents run it."
        />
      </div>

      {/* Full-bleed ticker */}
      <div className="mt-8 space-y-3">
        <TickerRow items={row1} direction="left" duration={80} />
        <TickerRow items={row2} direction="right" duration={90} />
      </div>
    </section>
  )
}
