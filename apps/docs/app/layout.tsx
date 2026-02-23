import './global.css'
import { RootProvider } from 'fumadocs-ui/provider'
import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { source } from '@/lib/source'
import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { DM_Serif_Display, Geist_Mono, Inter } from 'next/font/google'
import Image from 'next/image'

const dmSerifDisplay = DM_Serif_Display({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-instrument-serif',
  display: 'swap',
})

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    template: '%s | Nitejar Docs',
    default: 'Nitejar Docs',
  },
  description: 'Documentation for Nitejar, the self-hosted AI agent fleet.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${dmSerifDisplay.variable} ${inter.variable} ${geistMono.variable}`}
    >
      <body>
        <RootProvider>
          <DocsLayout
            tree={source.pageTree}
            nav={{
              title: (
                <span className="flex items-center gap-2 font-display tracking-wide text-gold-400">
                  <Image src="/logos/icon.png" alt="" width={24} height={24} />
                  Nitejar Docs
                </span>
              ),
              url: 'https://nitejar.dev',
            }}
            links={[
              {
                type: 'main',
                url: 'https://nitejar.dev',
                text: 'Home',
                external: true,
              },
            ]}
          >
            {children}
          </DocsLayout>
        </RootProvider>
      </body>
    </html>
  )
}
