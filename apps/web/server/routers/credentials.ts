import { TRPCError } from '@trpc/server'
import { isValidDomainPattern } from '@nitejar/agent/network-policy'
import {
  createCredential,
  deleteCredential,
  findAgentById,
  getCredentialById,
  getCredentialUsageSummary,
  isCredentialAliasAvailable,
  listCredentialAssignments,
  listCredentialsWithAgents,
  setAgentCredentialAssignment,
  updateCredential,
} from '@nitejar/database'
import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'

const aliasSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[a-z][a-z0-9_-]*$/)
const hostSchema = z.string().trim().min(1)

function validateAllowedHosts(hosts: string[]): void {
  if (hosts.length === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'allowedHosts must contain at least one host pattern.',
    })
  }

  for (const host of hosts) {
    if (!isValidDomainPattern(host)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Invalid host pattern: ${host}`,
      })
    }
  }
}

export const credentialsRouter = router({
  checkAlias: protectedProcedure
    .input(
      z.object({
        alias: aliasSchema,
        excludeCredentialId: z.string().trim().min(1).optional(),
      })
    )
    .query(async ({ input }) => {
      const available = await isCredentialAliasAvailable(input.alias, input.excludeCredentialId)
      return { available }
    }),

  list: protectedProcedure
    .input(
      z
        .object({
          provider: z.string().trim().min(1).optional(),
          enabled: z.boolean().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      return listCredentialsWithAgents({
        provider: input?.provider,
        enabled: input?.enabled,
      })
    }),

  getUsageSummary: protectedProcedure
    .input(
      z.object({
        credentialId: z.string().trim().min(1),
        windowSeconds: z.number().int().positive().optional(),
      })
    )
    .query(async ({ input }) => {
      const credential = await getCredentialById(input.credentialId)
      if (!credential) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Credential not found' })
      }

      return getCredentialUsageSummary(input.credentialId, input.windowSeconds)
    }),

  get: protectedProcedure.input(z.object({ credentialId: z.string() })).query(async ({ input }) => {
    const credential = await getCredentialById(input.credentialId)
    if (!credential) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Credential not found' })
    }

    const agents = await listCredentialAssignments(input.credentialId)

    return {
      ...credential,
      agents: agents.map((agent) => ({ id: agent.id, name: agent.name })),
    }
  }),

  create: protectedProcedure
    .input(
      z.object({
        alias: aliasSchema,
        provider: z.string().trim().min(1),
        secret: z.string().min(1),
        authKey: z.string().trim().min(1).optional(),
        authScheme: z.string().trim().min(1).nullable().optional(),
        allowedHosts: z.array(hostSchema),
        enabled: z.boolean().optional(),
        allowedInHeader: z.boolean().optional(),
        allowedInQuery: z.boolean().optional(),
        allowedInBody: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      validateAllowedHosts(input.allowedHosts)

      if (!input.allowedInHeader && !input.allowedInQuery && !input.allowedInBody) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'At least one allowed location (header, query, or body) is required.',
        })
      }

      try {
        return await createCredential({
          alias: input.alias,
          provider: input.provider,
          secret: input.secret,
          authType: 'api_key',
          authKey: input.authKey ?? '_',
          authScheme: input.authScheme ?? null,
          allowedHosts: input.allowedHosts,
          enabled: input.enabled,
          allowedInHeader: input.allowedInHeader,
          allowedInQuery: input.allowedInQuery,
          allowedInBody: input.allowedInBody,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create credential'
        if (message.toLowerCase().includes('unique')) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Credential alias already exists.',
          })
        }
        throw new TRPCError({ code: 'BAD_REQUEST', message })
      }
    }),

  update: protectedProcedure
    .input(
      z.object({
        credentialId: z.string(),
        provider: z.string().trim().min(1).optional(),
        secret: z.string().min(1).optional(),
        authKey: z.string().trim().min(1).optional(),
        authScheme: z.string().trim().min(1).nullable().optional(),
        allowedHosts: z.array(hostSchema).optional(),
        enabled: z.boolean().optional(),
        allowedInHeader: z.boolean().optional(),
        allowedInQuery: z.boolean().optional(),
        allowedInBody: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      if (input.allowedHosts) {
        validateAllowedHosts(input.allowedHosts)
      }

      const updated = await updateCredential(input.credentialId, {
        provider: input.provider,
        secret: input.secret,
        authKey: input.authKey,
        authScheme: input.authScheme,
        allowedHosts: input.allowedHosts,
        enabled: input.enabled,
        allowedInHeader: input.allowedInHeader,
        allowedInQuery: input.allowedInQuery,
        allowedInBody: input.allowedInBody,
      })

      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Credential not found' })
      }

      return updated
    }),

  delete: protectedProcedure
    .input(z.object({ credentialId: z.string() }))
    .mutation(async ({ input }) => {
      const deleted = await deleteCredential(input.credentialId)
      if (!deleted) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Credential not found' })
      }
      return { ok: true }
    }),

  setAgentAssignment: protectedProcedure
    .input(
      z.object({
        credentialId: z.string(),
        agentId: z.string(),
        enabled: z.boolean(),
      })
    )
    .mutation(async ({ input }) => {
      const credential = await getCredentialById(input.credentialId)
      if (!credential) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Credential not found' })
      }

      const agent = await findAgentById(input.agentId)
      if (!agent) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent not found' })
      }

      await setAgentCredentialAssignment(input)
      return { ok: true, ...input }
    }),

  listAssignments: protectedProcedure
    .input(z.object({ credentialId: z.string() }))
    .query(async ({ input }) => {
      const credential = await getCredentialById(input.credentialId)
      if (!credential) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Credential not found' })
      }

      const agents = await listCredentialAssignments(input.credentialId)
      return agents.map((agent) => ({ id: agent.id, name: agent.name }))
    }),
})

export type CredentialsRouter = typeof credentialsRouter
