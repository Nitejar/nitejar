'use client'

import {
  Gauge,
  Activity,
  Bot,
  Database,
  DollarSign,
  Plug,
  Sparkles,
  FlaskConical,
  MessageSquare,
  Users,
} from 'lucide-react'
import { motion } from 'motion/react'
import { SectionHeading } from '@/components/shared/SectionHeading'
import { staggerContainer, fadeInUp } from '@/lib/animations'
import { handleCardShimmer, handleGridShimmer } from '@/lib/card-shimmer'
import type { LucideIcon } from 'lucide-react'

interface Feature {
  icon: LucideIcon
  name: string
  description: string
  detail: string
}

const features: Feature[] = [
  {
    icon: Gauge,
    name: 'Command Center',
    description: 'Live fleet health, active operations, queue depth, and cost posture at a glance.',
    detail: 'Stat cards · agent roster · sparkline trends',
  },
  {
    icon: Activity,
    name: 'Activity',
    description:
      'Cross-channel run history. Every execution, every step, searchable and filterable.',
    detail: 'Run timeline · status tracking · source badges',
  },
  {
    icon: Bot,
    name: 'Agents',
    description:
      'Full agent builder. Identity, personality, model, skills, plugins, network policy, budgets — all in one config.',
    detail: 'Soul config · tool access · budget limits',
  },
  {
    icon: Database,
    name: 'Collections',
    description:
      'Shared structured data with schema governance. Give agents access to the knowledge they need.',
    detail: 'Schema enforcement · per-agent access control',
  },
  {
    icon: DollarSign,
    name: 'Costs',
    description:
      'Spend trends, per-agent breakdowns, source attribution. Set soft and hard budget limits.',
    detail: 'Daily trends · org/team/agent scopes',
  },
  {
    icon: Plug,
    name: 'Plugins',
    description:
      'Connect agents to GitHub, Telegram, webhooks, and more. Install community plugins or build your own.',
    detail: 'Channel integrations · custom plugins',
  },
  {
    icon: Sparkles,
    name: 'Skills',
    description:
      "Reusable knowledge packs, workflow templates, and scripts. Synced to each agent's sandbox.",
    detail: 'Knowledge · workflows · scripts',
  },
  {
    icon: FlaskConical,
    name: 'Evals',
    description:
      'Scoring pipelines and quality trends. Measure how well your agents are actually performing.',
    detail: 'Evaluators · score history · quality trends',
  },
  {
    icon: MessageSquare,
    name: 'Sessions',
    description:
      'Talk to one or more agents directly in-app. Real conversations, not just config and deploy.',
    detail: 'Multi-agent chat · in-app conversations',
  },
]

export function Features() {
  return (
    <section id="features" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading
          eyebrow="What's inside"
          title="One place to run the whole fleet"
          description="Everything you need to create, connect, observe, and manage your AI agents."
        />

        <motion.div
          className="mb-8"
          variants={fadeInUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
        >
          <div
            className="card-surface rounded-xl border border-gold-500/20 bg-night-900/80 p-6 md:p-8"
            onMouseMove={handleCardShimmer}
          >
            <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-8">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-gold-500/30 bg-gold-500/10">
                <Users className="h-6 w-6 text-gold-500" strokeWidth={1.5} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="mb-2 text-balance text-lg font-semibold text-moon-100">
                  Agents that work together without stepping on each other
                </h3>
                <p className="mb-3 text-sm leading-relaxed text-moon-200">
                  Put multiple agents in the same channel. Each one triages incoming messages
                  independently — responds when relevant, stays silent when not. No routing rules,
                  no orchestration config. The first agent to claim a message gets exclusive access.
                  Check the activity timeline to see every triage decision.
                </p>
                <p className="font-mono text-xs text-night-600">
                  semantic triage · silent pass · exclusive claims · activity log
                </p>
              </div>
            </div>
          </div>
        </motion.div>

        <motion.div
          className="card-grid grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          onMouseMove={handleGridShimmer}
        >
          {features.map((f) => (
            <motion.div
              key={f.name}
              variants={fadeInUp}
              className="card-surface rounded-xl border border-night-700/50 bg-night-900/90 p-6 backdrop-blur-sm"
            >
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-night-700/50 bg-night-800">
                  <f.icon className="h-4.5 w-4.5 text-gold-500" strokeWidth={1.5} />
                </div>
                <h3 className="font-semibold text-moon-100">{f.name}</h3>
              </div>
              <p className="mb-3 text-sm leading-relaxed text-moon-200">{f.description}</p>
              <p className="font-mono text-xs text-night-600">{f.detail}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
