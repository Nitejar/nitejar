import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'

export type ReleaseServerRoute = {
  status?: number
  headers?: Record<string, string>
  body: string | Buffer | Record<string, unknown>
}

export async function startReleaseServer(routes: Record<string, ReleaseServerRoute>): Promise<{
  baseUrl: string
  close: () => Promise<void>
}> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const key = req.url ?? '/'
    const route = routes[key]
    if (!route) {
      res.statusCode = 404
      res.end('not found')
      return
    }

    res.statusCode = route.status ?? 200
    for (const [header, value] of Object.entries(route.headers ?? {})) {
      res.setHeader(header, value)
    }

    if (Buffer.isBuffer(route.body)) {
      res.end(route.body)
      return
    }
    if (typeof route.body === 'string') {
      res.end(route.body)
      return
    }

    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(route.body))
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve release server address')
  }

  const close = async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close,
  }
}

export function createStandardReleaseRoutes(options: {
  baseUrl?: string
  version: string
  platform: string
  artifactPath: string
  sha256: string
  size: number
  includeVersionManifest?: boolean
  latestVersion?: string
  versionManifestStatus?: number
  latestManifestStatus?: number
  artifactStatus?: number
}): Record<string, ReleaseServerRoute> {
  const artifactFile = readFileSync(options.artifactPath)
  const artifactName = `nitejar-runtime-${options.platform}.tar.gz`
  const artifactUrl = options.baseUrl
    ? `${options.baseUrl}/${options.version}/${artifactName}`
    : `/${options.version}/${artifactName}`
  const latestVersion = options.latestVersion ?? options.version

  const latestManifest = {
    version: latestVersion,
    releasedAt: new Date().toISOString(),
    artifacts: {
      [options.platform]: {
        url: artifactUrl,
        sha256: options.sha256,
        size: options.size,
      },
    },
  }

  const versionManifest = {
    version: options.version,
    releasedAt: new Date().toISOString(),
    artifacts: {
      [options.platform]: {
        url: artifactUrl,
        sha256: options.sha256,
        size: options.size,
      },
    },
  }

  const routes: Record<string, ReleaseServerRoute> = {
    '/manifest.json': {
      status: options.latestManifestStatus,
      body: latestManifest,
    },
    [`/${options.version}/${artifactName}`]: {
      status: options.artifactStatus,
      body: artifactFile,
      headers: { 'content-type': 'application/gzip' },
    },
  }

  if (options.includeVersionManifest !== false) {
    routes[`/${options.version}/manifest.json`] = {
      status: options.versionManifestStatus,
      body: versionManifest,
    }
  }

  return routes
}
