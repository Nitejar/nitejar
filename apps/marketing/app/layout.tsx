import type { Metadata } from 'next'
import { DM_Serif_Display, Inter, Geist_Mono } from 'next/font/google'
import './globals.css'

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
  title: 'Nitejar — Your agents work the night shift',
  description:
    'Self-hosted AI agent control center. Create agents, connect channels, watch them work. Every action traceable, every cost visible.',
  metadataBase: new URL('https://nitejar.dev'),
  openGraph: {
    title: 'Nitejar — Your agents work the night shift',
    description:
      'Self-hosted AI agent control center. Create agents, connect channels, watch them work.',
    url: 'https://nitejar.dev',
    siteName: 'Nitejar',
    locale: 'en_US',
    type: 'website',
    images: [{ url: '/api/og', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Nitejar — Your agents work the night shift',
    description:
      'Self-hosted AI agent control center. Create agents, connect channels, watch them work.',
    images: ['/api/og'],
  },
  robots: {
    index: true,
    follow: true,
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${dmSerifDisplay.variable} ${inter.variable} ${geistMono.variable}`}
    >
      <body>{children}</body>
    </html>
  )
}
