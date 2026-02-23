'use client'

import { motion } from 'motion/react'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { changelogEntries } from '@/lib/changelog'
import { staggerContainer, fadeInUp } from '@/lib/animations'

const tagColors: Record<string, string> = {
  feature: 'border-gold-500/40 text-gold-400',
  release: 'border-ember-500/40 text-ember-500',
  plugins: 'border-gold-300/40 text-gold-300',
  agents: 'border-gold-300/40 text-gold-300',
  fix: 'border-night-600/40 text-moon-200',
}

export default function ChangelogPage() {
  return (
    <>
      <Navbar />
      <main className="pt-24 pb-16">
        <div className="mx-auto max-w-3xl px-6">
          {/* Header */}
          <div className="mb-16 text-center">
            <p className="mb-3 font-mono text-sm tracking-widest text-gold-500 uppercase">
              Changelog
            </p>
            <h1 className="font-display text-4xl text-gold-400 md:text-5xl">What&apos;s new</h1>
            <p className="mt-4 text-moon-200">
              Every release, traced and timestamped. Follow the receipts.
            </p>
          </div>

          {/* Timeline */}
          <motion.div
            className="relative"
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
          >
            {/* Vertical line */}
            <div
              className="absolute top-0 bottom-0 left-4 w-px bg-gradient-to-b from-gold-500/40 via-gold-500/20 to-transparent md:left-8"
              aria-hidden="true"
            />

            <div className="space-y-12">
              {changelogEntries.map((entry) => (
                <motion.article
                  key={entry.version}
                  variants={fadeInUp}
                  className="relative pl-12 md:pl-20"
                >
                  {/* Gold dot */}
                  <div
                    className="absolute top-1.5 left-2.5 h-3 w-3 rounded-full border-2 border-gold-500 bg-night-950 md:left-6.5"
                    aria-hidden="true"
                  />

                  {/* Date + version badge */}
                  <div className="mb-3 flex flex-wrap items-center gap-3">
                    <time className="font-mono text-sm text-night-600">{entry.date}</time>
                    <span className="rounded-full border border-gold-500/30 bg-night-900 px-3 py-0.5 font-mono text-xs text-gold-500">
                      v{entry.version}
                    </span>
                  </div>

                  {/* Title */}
                  <h2 className="mb-2 font-display text-xl text-gold-400">{entry.title}</h2>

                  {/* Body */}
                  <p className="mb-3 leading-relaxed text-moon-200">{entry.description}</p>

                  {/* Tag pills */}
                  <div className="flex flex-wrap gap-2">
                    {entry.tags.map((tag) => (
                      <span
                        key={tag}
                        className={`rounded-full border px-2.5 py-0.5 font-mono text-xs ${
                          tagColors[tag] ?? 'border-night-700 text-night-600'
                        }`}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </motion.article>
              ))}
            </div>
          </motion.div>
        </div>
      </main>
      <Footer />
    </>
  )
}
