/** @type {import('next').NextConfig} */
const docsOrigin = process.env.NITEJAR_DOCS_ORIGIN ?? 'http://localhost:3001'

const config = {
  images: { unoptimized: true },
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/docs',
        destination: `${docsOrigin}/docs`,
      },
      {
        source: '/docs/:path*',
        destination: `${docsOrigin}/docs/:path*`,
      },
    ]
  },
}

export default config
