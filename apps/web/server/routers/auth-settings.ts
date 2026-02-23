import { z } from 'zod'
import { protectedProcedure, router } from '../trpc'
import { getAuthSignupPolicy, updateAuthSignupPolicy } from '../services/auth-signup-policy'

const signupModeSchema = z.enum(['invite_only', 'approved_domain'])
const defaultRoleSchema = z.enum(['superadmin', 'admin', 'member'])

export const authSettingsRouter = router({
  getSignupPolicy: protectedProcedure.query(async () => {
    return getAuthSignupPolicy()
  }),

  updateSignupPolicy: protectedProcedure
    .input(
      z.object({
        mode: signupModeSchema,
        approvedDomains: z.array(z.string()),
        defaultRole: defaultRoleSchema,
      })
    )
    .mutation(async ({ input }) => {
      return updateAuthSignupPolicy({
        mode: input.mode,
        approvedDomains: input.approvedDomains,
        defaultRole: input.defaultRole,
      })
    }),
})
