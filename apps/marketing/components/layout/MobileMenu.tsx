'use client'

import { AnimatePresence, motion } from 'motion/react'

interface MobileMenuProps {
  open: boolean
  onClose: () => void
  links: { label: string; href: string }[]
}

export function MobileMenu({ open, onClose, links }: MobileMenuProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-x-0 top-16 z-40 border-b border-night-700/50 bg-night-950/95 backdrop-blur-lg md:hidden"
        >
          <div className="flex flex-col gap-1 px-6 py-4">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={onClose}
                className="rounded-lg px-3 py-2.5 text-moon-200 transition-colors hover:bg-night-800 hover:text-gold-400"
              >
                {link.label}
              </a>
            ))}
            <a
              href="https://github.com/nitejar/nitejar"
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}
              className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg bg-gold-500 px-4 py-2.5 font-semibold text-night-950 transition-colors hover:bg-gold-400"
            >
              Star on GitHub
            </a>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
