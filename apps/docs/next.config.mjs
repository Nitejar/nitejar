import { createMDX } from 'fumadocs-mdx/next'

/** @type {import('next').NextConfig} */
const config = {
  basePath: '/docs',
  images: { unoptimized: true },
  reactStrictMode: true,
}

const withMDX = createMDX()

export default withMDX(config)
