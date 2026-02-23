'use client'

import { motion } from 'motion/react'
import { SectionHeading } from '@/components/shared/SectionHeading'
import { staggerContainer, fadeInUp } from '@/lib/animations'

/* ------------------------------------------------------------------ */
/* Step 1: Create agents — faux agent builder card                     */
/* ------------------------------------------------------------------ */
function AgentBuilderMock() {
  return (
    <div className="panel-embossed-subtle overflow-hidden rounded-xl bg-night-950/90 backdrop-blur-sm">
      <div className="border-b border-white/[0.06] px-4 py-2.5">
        <span className="text-[0.65rem] font-medium tracking-wider text-white/30 uppercase">
          New agent
        </span>
      </div>
      <div className="space-y-3 p-4">
        {/* Name */}
        <div>
          <label className="mb-1 block text-[0.65rem] font-medium text-white/30 uppercase">
            Name
          </label>
          <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-white/80">
            nightowl
          </div>
        </div>
        {/* Avatar + Model row */}
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-[0.65rem] font-medium text-white/30 uppercase">
              Avatar
            </label>
            <div className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-gradient-to-b from-white/10 to-white/5 text-base">
              🦉
            </div>
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-[0.65rem] font-medium text-white/30 uppercase">
              Model
            </label>
            <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/50">
              claude-sonnet-4
            </div>
          </div>
        </div>
        {/* Soul */}
        <div>
          <label className="mb-1 block text-[0.65rem] font-medium text-white/30 uppercase">
            Personality
          </label>
          <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-xs leading-relaxed text-white/50">
            You&apos;re a diligent night-shift engineer. You triage bugs, check recent commits, and
            post clear diagnoses. Be thorough but concise.
          </div>
        </div>
        {/* Skills pills */}
        <div>
          <label className="mb-1 block text-[0.65rem] font-medium text-white/30 uppercase">
            Skills
          </label>
          <div className="flex flex-wrap gap-1.5">
            {['github-triage', 'code-review', 'write-summary'].map((skill) => (
              <span
                key={skill}
                className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 font-mono text-[0.65rem] text-white/60"
              >
                {skill}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Step 2: Connect channels — faux plugin connection panel             */
/* ------------------------------------------------------------------ */
function ChannelsMock() {
  const channels = [
    {
      icon: (
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
          <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" />
        </svg>
      ),
      name: 'GitHub',
      status: 'Connected',
      statusColor: 'text-emerald-400',
      detail: '3 repos · issues + PRs',
    },
    {
      icon: (
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 0 0-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38Z" />
        </svg>
      ),
      name: 'Telegram',
      status: 'Connected',
      statusColor: 'text-emerald-400',
      detail: '2 groups · DMs enabled',
    },
    {
      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="h-4 w-4"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
          />
        </svg>
      ),
      name: 'Webhooks',
      status: 'Ready',
      statusColor: 'text-amber-400',
      detail: '1 endpoint configured',
    },
  ]

  return (
    <div className="panel-embossed-subtle overflow-hidden rounded-xl bg-night-950/90 backdrop-blur-sm">
      <div className="border-b border-white/[0.06] px-4 py-2.5">
        <span className="text-[0.65rem] font-medium tracking-wider text-white/30 uppercase">
          Connected channels
        </span>
      </div>
      <div className="divide-y divide-white/[0.04]">
        {channels.map((ch) => (
          <div key={ch.name} className="flex items-center gap-3 px-4 py-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-white/60">
              {ch.icon}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white/80">{ch.name}</span>
                <span className={`text-[0.6rem] font-medium ${ch.statusColor}`}>{ch.status}</span>
              </div>
              <p className="text-xs text-white/30">{ch.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Step 3: Watch them work — faux activity feed                        */
/* ------------------------------------------------------------------ */
function ActivityMock() {
  const items = [
    {
      agent: '🦉',
      action: 'Posted diagnosis on issue #347',
      source: 'github',
      sourceColor: 'bg-white/10 text-white/50',
      time: '2m ago',
      status: 'bg-emerald-400',
    },
    {
      agent: '📡',
      action: 'Sent weekly digest to #engineering',
      source: 'telegram',
      sourceColor: 'bg-blue-400/10 text-blue-400',
      time: '8m ago',
      status: 'bg-emerald-400',
    },
    {
      agent: '🔧',
      action: 'Opened PR #412 — fix auth token refresh',
      source: 'github',
      sourceColor: 'bg-white/10 text-white/50',
      time: '14m ago',
      status: 'bg-emerald-400',
    },
    {
      agent: '🦉',
      action: 'Reviewing PR #409',
      source: 'github',
      sourceColor: 'bg-white/10 text-white/50',
      time: 'now',
      status: 'bg-blue-400 animate-pulse',
    },
  ]

  return (
    <div className="panel-embossed-subtle overflow-hidden rounded-xl bg-night-950/90 backdrop-blur-sm">
      <div className="border-b border-white/[0.06] px-4 py-2.5">
        <span className="text-[0.65rem] font-medium tracking-wider text-white/30 uppercase">
          Recent activity
        </span>
      </div>
      <div className="divide-y divide-white/[0.04]">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-white/10 bg-gradient-to-b from-white/10 to-white/5 text-xs">
              {item.agent}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs leading-relaxed text-white/70">{item.action}</p>
              <div className="mt-1 flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[0.6rem] ${item.sourceColor}`}>
                  {item.source}
                </span>
                <span className="text-[0.6rem] text-white/20">{item.time}</span>
              </div>
            </div>
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${item.status}`} />
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Section                                                             */
/* ------------------------------------------------------------------ */
const steps = [
  {
    number: '01',
    title: 'Create agents',
    description:
      'Give each agent a name, a personality, skills, and a budget. Full config — identity, model, tools, network policy — all in one place.',
    mock: AgentBuilderMock,
  },
  {
    number: '02',
    title: 'Connect channels',
    description:
      'Plug agents into Telegram, GitHub, webhooks, or talk to them directly in-app. One agent, many surfaces.',
    mock: ChannelsMock,
  },
  {
    number: '03',
    title: 'Watch the fleet',
    description:
      "Live activity, cost trends, agent-by-agent breakdowns. See what each agent did, what it spent, and what it's doing next.",
    mock: ActivityMock,
  },
]

export function HowItWorks() {
  return (
    <section id="how-it-works" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-5xl px-6">
        <SectionHeading
          eyebrow="How it works"
          title="Three steps to the night shift"
          description="Set up in minutes. The complexity lives in what your agents do, not in getting them running."
        />

        <motion.div
          className="space-y-16 md:space-y-24"
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
        >
          {steps.map((step, i) => (
            <motion.div
              key={step.number}
              variants={fadeInUp}
              className={`flex flex-col items-center gap-8 md:flex-row md:gap-12 ${
                i % 2 === 1 ? 'md:flex-row-reverse' : ''
              }`}
            >
              {/* Text */}
              <div
                className={`flex-1 text-center md:text-left ${i % 2 === 1 ? 'md:text-right' : ''}`}
              >
                <span className="font-mono text-sm text-gold-500">{step.number}</span>
                <h3 className="mt-2 font-display text-2xl text-gold-400 md:text-3xl">
                  {step.title}
                </h3>
                <p className="mt-3 leading-relaxed text-moon-200">{step.description}</p>
              </div>

              {/* Faux UI */}
              <div className="w-full max-w-sm flex-1">
                <step.mock />
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
