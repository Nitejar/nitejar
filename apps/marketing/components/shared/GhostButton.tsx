import type { AnchorHTMLAttributes } from 'react'

export function GhostButton({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      {...props}
      className="inline-flex items-center gap-2 rounded-lg border border-night-700 px-6 py-3 font-semibold text-moon-100 transition-all hover:border-gold-500/50 hover:text-gold-400"
    >
      {children}
    </a>
  )
}
