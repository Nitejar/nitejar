import type { AnchorHTMLAttributes } from 'react'

export function GoldButton({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      {...props}
      className="inline-flex items-center gap-2 rounded-lg bg-gold-500 px-6 py-3 font-semibold text-night-950 transition-all hover:bg-gold-400 hover:gold-glow"
    >
      {children}
    </a>
  )
}
