import { betterAuth, APIError } from 'better-auth'
import type { Auth } from 'better-auth'
import { createAuthMiddleware } from 'better-auth/api'
import { nextCookies } from 'better-auth/next-js'
import { mcp } from 'better-auth/plugins'
import { getDatabaseType, getDb } from '@nitejar/database'
import { SIGNUP_MARKER_HEADER, verifySignupMarker } from './signup-marker'
import { extractEmailDomain, getAuthSignupPolicy } from '@/server/services/auth-signup-policy'

const baseURL =
  process.env.APP_URL ??
  process.env.APP_BASE_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  'http://localhost:3000'

export const MCP_SCOPES = ['agents.read', 'agents.write', 'memories.write'] as const

function createAuth(): Auth {
  return betterAuth({
    baseURL,
    secret: process.env.BETTER_AUTH_SECRET ?? process.env.AUTH_SECRET,
    database: {
      db: getDb() as never,
      type: getDatabaseType() === 'postgres' ? 'postgres' : 'sqlite',
      casing: 'snake',
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
    },
    user: {
      modelName: 'users',
      fields: {
        emailVerified: 'email_verified',
        image: 'avatar_url',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      additionalFields: {
        role: {
          type: 'string',
          defaultValue: 'member',
        },
        status: {
          type: 'string',
          defaultValue: 'active',
        },
      },
    },
    session: {
      fields: {
        userId: 'user_id',
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
      },
    },
    account: {
      fields: {
        userId: 'user_id',
        accountId: 'account_id',
        providerId: 'provider_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        password: 'password_hash',
      },
    },
    verification: {
      fields: {
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-up/email') {
          return
        }

        const marker = ctx.getHeader(SIGNUP_MARKER_HEADER)
        if (verifySignupMarker(marker)) {
          return
        }

        const policy = await getAuthSignupPolicy()
        if (policy.mode === 'invite_only') {
          throw new APIError('FORBIDDEN', {
            message: 'Signups are invite-only',
            code: 'INVITE_ONLY_SIGNUP',
          })
        }

        const body =
          ctx.body && typeof ctx.body === 'object' ? (ctx.body as Record<string, unknown>) : null
        const email = typeof body?.email === 'string' ? body.email.toLowerCase().trim() : ''
        const domain = extractEmailDomain(email)
        if (!domain || !policy.approvedDomains.includes(domain)) {
          throw new APIError('FORBIDDEN', {
            message: 'This email domain is not approved for self-signup',
            code: 'SIGNUP_DOMAIN_NOT_ALLOWED',
          })
        }

        if (!body) {
          throw new APIError('BAD_REQUEST', {
            message: 'Invalid signup payload',
          })
        }

        body.email = email
        body.role = policy.defaultRole
        body.status = 'active'
      }),
    },
    plugins: [
      nextCookies(),
      mcp({
        loginPage: `${baseURL}/login`,
        resource: `${baseURL}/api/mcp`,
        oidcConfig: {
          loginPage: `${baseURL}/login`,
          scopes: [...MCP_SCOPES],
          schema: {
            oauthApplication: {
              modelName: 'oauth_application',
              fields: {
                clientId: 'client_id',
                clientSecret: 'client_secret',
                redirectUrls: 'redirect_urls',
                authenticationScheme: 'authentication_scheme',
                userId: 'user_id',
                createdAt: 'created_at',
                updatedAt: 'updated_at',
              },
            },
            oauthAccessToken: {
              modelName: 'oauth_access_token',
              fields: {
                accessToken: 'access_token',
                refreshToken: 'refresh_token',
                accessTokenExpiresAt: 'access_token_expires_at',
                refreshTokenExpiresAt: 'refresh_token_expires_at',
                clientId: 'client_id',
                userId: 'user_id',
                createdAt: 'created_at',
                updatedAt: 'updated_at',
              },
            },
            oauthConsent: {
              modelName: 'oauth_consent',
              fields: {
                clientId: 'client_id',
                userId: 'user_id',
                createdAt: 'created_at',
                updatedAt: 'updated_at',
                consentGiven: 'consent_given',
              },
            },
          } as never,
        },
      }),
    ],
  })
}

let authSingleton: Auth | null = null

export function getAuth(): Auth {
  // Keep auth initialization lazy so Next.js build-time module evaluation
  // does not eagerly require runtime-only auth secrets.
  if (!authSingleton) {
    authSingleton = createAuth()
  }
  return authSingleton
}

export type AuthSession = Awaited<ReturnType<Auth['api']['getSession']>>
