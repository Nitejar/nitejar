import Image from 'next/image'
const footerLinks = [
  {
    heading: 'Product',
    links: [
      { label: 'How it works', href: '#how-it-works' },
      { label: 'Use cases', href: '#use-cases' },
      { label: 'Changelog', href: '/changelog' },
    ],
  },
  {
    heading: 'Community',
    links: [
      { label: 'GitHub', href: 'https://github.com/nitejar/nitejar' },
      { label: 'Discord', href: 'https://discord.gg/9Dh4QaQ4' },
      { label: 'Docs', href: '/docs' },
    ],
  },
]

function BirdIcon() {
  return (
    <Image
      src="/logos/icon.png"
      alt=""
      width={32}
      height={32}
      className="h-8 w-8"
      aria-hidden="true"
    />
  )
}

export function Footer() {
  return (
    <footer className="border-t border-night-700/50 bg-night-950/80 backdrop-blur-sm">
      <div className="mx-auto max-w-6xl px-6 py-10 md:py-16">
        <div className="grid gap-12 md:grid-cols-4">
          {/* Brand */}
          <div className="md:col-span-2">
            <div className="flex items-center gap-3">
              <BirdIcon />
              <span className="font-display text-xl text-gold-500">Nitejar</span>
            </div>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-moon-200">
              Self-hosted AI agent fleet. Your agents work the night shift — you check in when you
              feel like it.
            </p>
          </div>

          {/* Link columns */}
          {footerLinks.map((group) => (
            <div key={group.heading}>
              <h3 className="mb-3 text-xs font-medium tracking-wide text-night-600 uppercase">
                {group.heading}
              </h3>
              <ul className="space-y-2">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="text-sm text-moon-200 transition-colors hover:text-gold-400"
                      {...(link.href.startsWith('http')
                        ? { target: '_blank', rel: 'noopener noreferrer' }
                        : {})}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-night-700/30 pt-8 text-xs text-night-600 md:flex-row">
          <p>Apache-2.0 &middot; Self-hosted &middot; No vendor lock-in</p>
          <p>The night shift never sleeps.</p>
        </div>
      </div>
    </footer>
  )
}
