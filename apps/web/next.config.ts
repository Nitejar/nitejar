import type { NextConfig } from 'next'

type WebpackConfig = {
  externals?: unknown
}

const nextConfig: NextConfig = {
  output: 'standalone',
  onDemandEntries: {
    // Keep recently visited routes hot in dev to avoid frequent re-compiles
    // during normal navigation.
    maxInactiveAge: 5 * 60 * 1000,
    pagesBufferLength: 8,
  },
  experimental: {
    optimizePackageImports: ['@tabler/icons-react', 'recharts'],
  },
  transpilePackages: [
    '@nitejar/agent',
    '@nitejar/config',
    '@nitejar/connectors-github',
    '@nitejar/core',
    '@nitejar/database',
    '@nitejar/plugin-handlers',
    '@nitejar/sprites',
  ],
  serverExternalPackages: ['better-sqlite3'],
  async redirects() {
    return await Promise.resolve([
      {
        source: '/inbox',
        destination: '/work-items',
        permanent: false,
      },
      {
        source: '/inbox/:id',
        destination: '/work-items/:id',
        permanent: false,
      },
      {
        source: '/command-center',
        destination: '/fleet',
        permanent: true,
      },
      {
        source: '/agents',
        destination: '/fleet',
        permanent: true,
      },
      {
        source: '/admin',
        destination: '/',
        permanent: true,
      },
      {
        source: '/admin/:path*',
        destination: '/:path*',
        permanent: true,
      },
    ])
  },
  webpack: (config: WebpackConfig) => {
    // Force better-sqlite3 to be treated as a CommonJS external
    // This prevents webpack from trying to bundle the native module
    const externalConfig = { 'better-sqlite3': 'commonjs better-sqlite3' }
    const existingExternals = config.externals
    const externals = normalizeExternals(existingExternals)
    externals.push(externalConfig)
    config.externals = externals
    return config
  },
}

export default nextConfig

function normalizeExternals(externals: unknown): unknown[] {
  if (Array.isArray(externals)) {
    return externals.slice()
  }
  if (externals) {
    return [externals]
  }
  return []
}
