'use client'

import { useMemo, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { motion } from 'motion/react'
import { SectionHeading } from '@/components/shared/SectionHeading'
import { fadeInUp } from '@/lib/animations'

type QuickStartTab = {
  id: string
  label: string
  command: string
  description: string
}

const tabs: QuickStartTab[] = [
  {
    id: 'one-liner',
    label: 'One-liner',
    command: 'npx @nitejar/cli up',
    description: 'Downloads runtime, runs migrations, and starts the daemon.',
  },
  {
    id: 'from-source',
    label: 'From source',
    command:
      'git clone https://github.com/nitejar/nitejar.git && cd nitejar && pnpm install && pnpm dev',
    description: 'Advanced path for contributors who want the full source workspace.',
  },
  {
    id: 'docker',
    label: 'Docker',
    command:
      'docker run -d --name nitejar -p 3000:3000 -v nitejar-data:/app/data -e ENCRYPTION_KEY="$(openssl rand -hex 32)" ghcr.io/nitejar/nitejar:latest',
    description: 'Containerized runtime with persistent data volume.',
  },
]

export function QuickStart() {
  const [activeTabId, setActiveTabId] = useState('one-liner')
  const [copied, setCopied] = useState(false)

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [activeTabId]
  )

  const activeCommand = activeTab?.command ?? ''

  async function handleCopy(): Promise<void> {
    await navigator.clipboard.writeText(activeCommand)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <section id="quickstart" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-6">
        <SectionHeading
          eyebrow="Quick start"
          title="Run the fleet in one command"
          description="Start with npx. Move to source or Docker when you need deeper control."
        />

        <motion.div
          variants={fadeInUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          className="overflow-hidden rounded-2xl border border-gold-500/20 bg-night-900/80"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-night-700/60 bg-night-950/70 px-4 py-3 md:px-6">
            <div className="flex flex-wrap gap-2">
              {tabs.map((tab) => {
                const active = tab.id === activeTabId
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTabId(tab.id)}
                    className={`rounded-md border px-3 py-1.5 font-mono text-xs tracking-wide ${
                      active
                        ? 'border-gold-500/60 bg-gold-500/20 text-gold-300'
                        : 'border-night-700/70 bg-night-900 text-night-600 hover:border-gold-500/30 hover:text-moon-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                )
              })}
            </div>

            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-md border border-night-700/70 bg-night-900 px-3 py-1.5 font-mono text-xs text-moon-200 hover:border-gold-500/40"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 text-night-600" />
                  Copy
                </>
              )}
            </button>
          </div>

          <div className="space-y-4 px-4 py-5 md:px-6 md:py-6">
            <p className="font-mono text-xs tracking-wide text-night-600 uppercase">
              {activeTab?.description}
            </p>
            <div className="rounded-xl border border-night-700/50 bg-night-950 p-4 md:p-5">
              <code className="block overflow-x-auto font-mono text-sm text-moon-100 md:text-base">
                <span className="mr-2 text-gold-500">$</span>
                {activeCommand}
              </code>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
