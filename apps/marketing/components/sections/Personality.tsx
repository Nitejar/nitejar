'use client'

import { motion } from 'motion/react'
import { SectionHeading } from '@/components/shared/SectionHeading'
import { SlideUp } from '@/components/shared/SlideUp'

const agents = [
  {
    emoji: '🦉',
    name: 'nightowl',
    status: 'busy',
    statusColor: 'bg-blue-400',
    pulse: true,
    runs: 142,
    success: '97%',
    cost: '$1.23',
    lastActive: '2m ago',
  },
  {
    emoji: '🔧',
    name: 'fixer',
    status: 'idle',
    statusColor: 'bg-emerald-400',
    pulse: false,
    runs: 89,
    success: '94%',
    cost: '$0.87',
    lastActive: '14m ago',
  },
  {
    emoji: '📡',
    name: 'scout',
    status: 'busy',
    statusColor: 'bg-blue-400',
    pulse: true,
    runs: 231,
    success: '99%',
    cost: '$2.10',
    lastActive: 'now',
  },
]

const operations = [
  {
    agent: '🦉',
    title: 'Triaging issue #347',
    source: 'github',
    sourceColor: 'bg-white/10',
    duration: '1m 12s',
  },
  {
    agent: '📡',
    title: 'Weekly digest draft',
    source: 'scheduler',
    sourceColor: 'bg-amber-400/10 text-amber-400',
    duration: '0m 34s',
  },
]

export function Personality() {
  return (
    <section className="relative py-24 md:py-32">
      <div className="mx-auto max-w-5xl px-6">
        <SectionHeading
          eyebrow="Command center"
          title="See everything your agents do."
          description="Live fleet health, active operations, cost tracking. One screen to know exactly what's happening."
        />

        <SlideUp>
          <div className="panel-embossed mx-auto max-w-4xl overflow-hidden rounded-xl bg-night-950/90 backdrop-blur-sm">
            {/* Top bar */}
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                <span className="text-xs font-medium text-white/50">Fleet healthy</span>
              </div>
              <div className="flex gap-1">
                {['Today', '7d', '30d'].map((period, i) => (
                  <span
                    key={period}
                    className={`rounded px-2.5 py-1 text-xs ${
                      i === 0 ? 'bg-white/10 font-medium text-white' : 'text-white/40'
                    }`}
                  >
                    {period}
                  </span>
                ))}
              </div>
            </div>

            {/* Stat row */}
            <div className="grid grid-cols-4 border-b border-white/[0.06]">
              {[
                { label: 'Agents', value: '3' },
                { label: 'Runs today', value: '47' },
                { label: 'Success', value: '96.8%' },
                { label: 'Spend', value: '$4.20' },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="border-r border-white/[0.06] px-5 py-4 last:border-r-0"
                >
                  <p className="text-[0.65rem] font-medium tracking-wider text-white/30 uppercase">
                    {stat.label}
                  </p>
                  <p className="mt-1 font-mono text-xl tabular-nums text-white/90">{stat.value}</p>
                </div>
              ))}
            </div>

            <div className="grid md:grid-cols-5">
              {/* Agent roster */}
              <div className="border-r border-white/[0.06] md:col-span-3">
                <div className="border-b border-white/[0.06] px-5 py-2.5">
                  <span className="text-[0.65rem] font-medium tracking-wider text-white/30 uppercase">
                    Agent roster
                  </span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-[0.65rem] font-medium tracking-wider text-white/30 uppercase">
                      <td className="px-5 py-2">Agent</td>
                      <td className="px-3 py-2">Status</td>
                      <td className="hidden px-3 py-2 text-right sm:table-cell">Runs</td>
                      <td className="hidden px-3 py-2 text-right sm:table-cell">Cost</td>
                    </tr>
                  </thead>
                  <tbody>
                    {agents.map((agent) => (
                      <motion.tr
                        key={agent.name}
                        className="border-b border-white/[0.04] last:border-b-0"
                        initial={{ opacity: 0 }}
                        whileInView={{ opacity: 1 }}
                        viewport={{ once: true }}
                      >
                        <td className="px-5 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-gradient-to-b from-white/10 to-white/5 text-sm">
                              {agent.emoji}
                            </span>
                            <span className="font-medium text-white/80">{agent.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${agent.statusColor} ${
                                agent.pulse ? 'animate-pulse' : ''
                              }`}
                            />
                            <span className="text-xs text-white/50">{agent.status}</span>
                          </div>
                        </td>
                        <td className="hidden px-3 py-2.5 text-right font-mono text-xs tabular-nums text-white/50 sm:table-cell">
                          {agent.runs}
                        </td>
                        <td className="hidden px-3 py-2.5 text-right font-mono text-xs tabular-nums text-white/50 sm:table-cell">
                          {agent.cost}
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Active ops */}
              <div className="md:col-span-2">
                <div className="border-b border-white/[0.06] px-5 py-2.5">
                  <span className="text-[0.65rem] font-medium tracking-wider text-white/30 uppercase">
                    Active operations
                  </span>
                </div>
                <div className="divide-y divide-white/[0.04]">
                  {operations.map((op) => (
                    <div key={op.title} className="flex items-center gap-3 px-5 py-3">
                      <span className="text-sm">{op.agent}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs text-white/70">{op.title}</p>
                        <span
                          className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[0.6rem] ${op.sourceColor}`}
                        >
                          {op.source}
                        </span>
                      </div>
                      <span className="shrink-0 font-mono text-xs tabular-nums text-white/30">
                        {op.duration}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </SlideUp>
      </div>
    </section>
  )
}
