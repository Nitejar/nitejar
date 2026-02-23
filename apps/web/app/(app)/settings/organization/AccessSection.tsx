'use client'

import { useEffect, useState } from 'react'
import { trpc } from '@/lib/trpc'
import { IconLock, IconMailCheck } from '@tabler/icons-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'

type SignupMode = 'invite_only' | 'approved_domain'
type DefaultRole = 'superadmin' | 'admin' | 'member'

export function AccessSection() {
  const [mode, setMode] = useState<SignupMode>('invite_only')
  const [domainsInput, setDomainsInput] = useState('')
  const [defaultRole, setDefaultRole] = useState<DefaultRole>('member')
  const [status, setStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const policyQuery = trpc.authSettings.getSignupPolicy.useQuery()
  const updatePolicy = trpc.authSettings.updateSignupPolicy.useMutation({
    onSuccess: (data) => {
      setMode(data.mode)
      setDomainsInput(data.approvedDomains.join('\n'))
      setDefaultRole(data.defaultRole)
      setStatus({ type: 'success', text: 'Access settings saved.' })
    },
    onError: () => {
      setStatus({ type: 'error', text: 'Failed to save access settings.' })
    },
  })

  useEffect(() => {
    if (!policyQuery.data) return
    setMode(policyQuery.data.mode)
    setDomainsInput(policyQuery.data.approvedDomains.join('\n'))
    setDefaultRole(policyQuery.data.defaultRole)
  }, [policyQuery.data])

  const handleSave = () => {
    setStatus(null)
    const approvedDomains = domainsInput
      .split(/[,\n]/)
      .map((value) => value.trim())
      .filter(Boolean)

    updatePolicy.mutate({
      mode,
      approvedDomains,
      defaultRole,
    })
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/5">
              <IconLock className="h-5 w-5 text-white/80" />
            </div>
            <div>
              <CardTitle className="text-base">Signup Policy</CardTitle>
              <CardDescription>
                Choose invite-only access or allow self-signup for approved domains.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>Mode</Label>
            <NativeSelect
              value={mode}
              onChange={(event) => setMode(event.target.value as SignupMode)}
              disabled={policyQuery.isLoading}
            >
              <NativeSelectOption value="invite_only">Invite only</NativeSelectOption>
              <NativeSelectOption value="approved_domain">Approved domains</NativeSelectOption>
            </NativeSelect>
          </div>

          <div className="space-y-2">
            <Label>Default Role For Self-Signups</Label>
            <NativeSelect
              value={defaultRole}
              onChange={(event) => setDefaultRole(event.target.value as DefaultRole)}
              disabled={policyQuery.isLoading}
            >
              <NativeSelectOption value="member">member</NativeSelectOption>
              <NativeSelectOption value="admin">admin</NativeSelectOption>
              <NativeSelectOption value="superadmin">superadmin</NativeSelectOption>
            </NativeSelect>
          </div>

          <div className="space-y-2">
            <Label>Approved Domains</Label>
            <Textarea
              value={domainsInput}
              onChange={(event) => setDomainsInput(event.target.value)}
              placeholder={'nitejar.dev\nexample.com'}
              rows={6}
              disabled={policyQuery.isLoading || mode !== 'approved_domain'}
            />
            <p className="text-xs text-muted-foreground">
              Enter one domain per line or comma separated. `@` is optional.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleSave} disabled={updatePolicy.isPending || policyQuery.isLoading}>
              {updatePolicy.isPending ? 'Saving...' : 'Save'}
            </Button>
            {status ? (
              <span
                className={
                  status.type === 'success' ? 'text-xs text-emerald-300' : 'text-xs text-rose-300'
                }
              >
                {status.text}
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader>
          <CardTitle className="text-base">How It Works</CardTitle>
          <CardDescription>There is no open signup mode.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-xs text-muted-foreground">
          <div className="rounded-lg border border-white/10 bg-black/20 p-4">
            <div className="mb-2 flex items-center gap-2 text-white/80">
              <IconLock className="h-4 w-4" />
              <p className="font-medium">Invite only</p>
            </div>
            <p>Only bootstrap and invite acceptance can create accounts.</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 p-4">
            <div className="mb-2 flex items-center gap-2 text-white/80">
              <IconMailCheck className="h-4 w-4" />
              <p className="font-medium">Approved domains</p>
            </div>
            <p>
              Users can self-sign up only when their email domain matches this allowlist. New
              self-signups get the configured default role.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
