'use client'

import { motion } from 'motion/react'
import Image from 'next/image'
import { HeroCTAs } from './HeroCTAs'

export function Hero() {
  return (
    <section className="relative flex min-h-screen items-center justify-center overflow-hidden">
      {/* Content */}
      <div className="relative z-10 mx-auto max-w-5xl px-6 pt-24 pb-16 text-center">
        {/* Bird mascot */}
        <motion.div
          className="relative mx-auto mb-8 w-48 md:w-64"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, ease: [0.25, 0.4, 0.25, 1] }}
        >
          {/* Solid circle behind bird to mask stars through transparency */}
          <div className="absolute inset-0 m-auto aspect-square w-full rounded-full bg-night-950" />
          <Image
            src="/logos/nitejar-plain.png"
            alt="Nitejar — nightjar bird perched on a crescent moon"
            width={845}
            height={780}
            priority
            className="relative h-auto w-full"
          />
        </motion.div>

        {/* Headline */}
        <motion.h1
          className="font-display text-balance text-5xl leading-tight text-gold-400 gold-text-glow md:text-7xl"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3, ease: [0.25, 0.4, 0.25, 1] }}
        >
          Your agents work
          <br />
          the night shift
        </motion.h1>

        {/* Sub-text */}
        <motion.p
          className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-moon-200 md:text-xl"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.5, ease: [0.25, 0.4, 0.25, 1] }}
        >
          Self-hosted AI agent fleet. Create agents, give them skills, plug them into your channels.
          You sleep, they ship.
        </motion.p>

        {/* CTAs */}
        <motion.div
          className="mt-10"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.7, ease: [0.25, 0.4, 0.25, 1] }}
        >
          <HeroCTAs />
        </motion.div>

        {/* Scroll indicator */}
        <motion.div
          className="mt-16"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5, duration: 1 }}
        >
          <motion.div
            className="mx-auto h-8 w-px bg-gradient-to-b from-gold-500/50 to-transparent"
            animate={{ scaleY: [1, 1.5, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          />
        </motion.div>
      </div>
    </section>
  )
}
