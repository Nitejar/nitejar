'use client'

import { motion } from 'motion/react'
import { SectionHeading } from '@/components/shared/SectionHeading'
import { fadeInUp } from '@/lib/animations'

/* ------------------------------------------------------------------ */
/* Faux chat panel — multi-agent collaboration scenario                */
/* ------------------------------------------------------------------ */

interface ChatMessage {
  avatar: string
  name: string
  text: string
  time: string
  isHuman?: boolean
}

const messages: ChatMessage[] = [
  {
    avatar: '👤',
    name: 'Sarah',
    text: 'Getting 502s on the checkout API. Customers are seeing payment failures. Can someone look?',
    time: '2:14 PM',
    isHuman: true,
  },
  {
    avatar: '🦉',
    name: 'nightowl',
    text: 'On it. Seeing elevated error rates starting 2:08 PM. The payment-service pod is restarting in a loop — OOM kill. Last deploy bumped the batch size from 100 to 5000. Rolling back now.',
    time: '2:14 PM',
  },
  {
    avatar: '📡',
    name: 'scout',
    text: "Confirming from monitoring: p99 latency spiked 12x at 2:08. Memory usage hit 98% on payment-service-7b. Three other services are healthy. I'll set an alert if error rates don't drop after the rollback.",
    time: '2:15 PM',
  },
]

interface TriageEntry {
  avatar: string
  name: string
  decision: string
  decisionColor: string
}

const triageLog: TriageEntry[] = [
  { avatar: '🦉', name: 'nightowl', decision: 'responded', decisionColor: 'text-emerald-400' },
  { avatar: '🔧', name: 'fixer', decision: 'passed', decisionColor: 'text-white/30' },
  { avatar: '📡', name: 'scout', decision: 'responded', decisionColor: 'text-emerald-400' },
]

function ChatMock() {
  return (
    <div className="panel-embossed overflow-hidden rounded-xl bg-night-950/90 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
        <span className="text-[0.65rem] font-medium tracking-wider text-white/30 uppercase">
          #ops-alerts
        </span>
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span className="text-[0.6rem] text-white/30">3 agents</span>
        </div>
      </div>

      {/* Messages */}
      <div className="divide-y divide-white/[0.04]">
        {messages.map((msg, i) => (
          <div key={i} className="px-4 py-3">
            <div className="mb-1 flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-md border border-white/10 bg-gradient-to-b from-white/10 to-white/5 text-[0.6rem]">
                {msg.avatar}
              </span>
              <span
                className={`text-xs font-medium ${msg.isHuman ? 'text-white/70' : 'text-gold-400'}`}
              >
                {msg.name}
              </span>
              <span className="text-[0.6rem] text-white/20">{msg.time}</span>
            </div>
            <p className="pl-7 text-xs leading-relaxed text-white/60">{msg.text}</p>
          </div>
        ))}
      </div>

      {/* Triage summary */}
      <div className="border-t border-white/[0.06] px-4 py-2.5">
        <span className="mb-2 block text-[0.6rem] font-medium tracking-wider text-white/20 uppercase">
          Triage decisions
        </span>
        <div className="flex gap-4">
          {triageLog.map((entry) => (
            <div key={entry.name} className="flex items-center gap-1.5">
              <span className="text-[0.6rem]">{entry.avatar}</span>
              <span className="text-[0.6rem] text-white/40">{entry.name}</span>
              <span className={`text-[0.6rem] font-medium ${entry.decisionColor}`}>
                {entry.decision}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Section                                                             */
/* ------------------------------------------------------------------ */

export function Collaboration() {
  return (
    <section id="collaboration" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-5xl px-6">
        <SectionHeading
          eyebrow="Multi-agent"
          title="One channel. Multiple agents. Zero crosstalk."
          description="Agents triage messages independently, claim exclusive turns, and stay silent when it's not their domain. No routing rules — just distinct roles and semantic understanding."
        />

        <motion.div
          className="mx-auto max-w-2xl"
          variants={fadeInUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
        >
          <ChatMock />
        </motion.div>
      </div>
    </section>
  )
}
