'use client'

import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { trpc } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

const roleOptions = ['superadmin', 'admin', 'member'] as const

type InviteFormValues = {
  name: string
  email: string
  avatarUrl?: string
  role: (typeof roleOptions)[number]
}

interface InviteMemberFormProps {
  onSuccess?: (result: { inviteUrl: string; email: string; emailSent: boolean }) => void
}

export function InviteMemberForm({ onSuccess }: InviteMemberFormProps) {
  const utils = trpc.useUtils()
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [inviteEmail, setInviteEmail] = useState<string | null>(null)
  const [emailSent, setEmailSent] = useState<boolean | null>(null)

  const inviteForm = useForm<InviteFormValues>({
    defaultValues: {
      name: '',
      email: '',
      avatarUrl: '',
      role: 'member',
    },
  })

  const inviteMember = trpc.org.createInvite.useMutation({
    onSuccess: (data: { inviteUrl: string; emailSent: boolean }, variables: { email: string }) => {
      setInviteUrl(data.inviteUrl)
      setInviteEmail(variables.email)
      setEmailSent(data.emailSent)
      void utils.org.listMembers.invalidate()
      inviteForm.reset({
        name: '',
        email: '',
        avatarUrl: '',
        role: 'member',
      })
      onSuccess?.({ inviteUrl: data.inviteUrl, email: variables.email, emailSent: data.emailSent })
    },
  })

  const inviteSubmit = inviteForm.handleSubmit((values: InviteFormValues) => {
    setInviteUrl(null)
    setInviteEmail(null)
    setEmailSent(null)
    inviteMember.mutate({
      name: values.name.trim(),
      email: values.email.trim(),
      role: values.role,
      avatarUrl: values.avatarUrl?.trim() || null,
    })
  })

  const statusText = useMemo(() => {
    if (inviteMember.isPending) return 'Sending invite...'
    if (inviteMember.isError) return inviteMember.error.message
    if (inviteUrl && inviteEmail && emailSent === false) {
      return `Invite ready for ${inviteEmail}. Email delivery is off because RESEND_API_KEY is not set.`
    }
    if (inviteUrl && inviteEmail) return `Invite sent to ${inviteEmail}`
    return null
  }, [
    inviteMember.isPending,
    inviteMember.isError,
    inviteMember.error,
    inviteUrl,
    inviteEmail,
    emailSent,
  ])

  return (
    <div className="space-y-4 text-xs text-muted-foreground">
      <form onSubmit={inviteSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label className="text-[0.65rem] uppercase tracking-[0.2em]">Name</Label>
          <Input placeholder="Jane Operator" {...inviteForm.register('name', { required: true })} />
        </div>
        <div className="space-y-2">
          <Label className="text-[0.65rem] uppercase tracking-[0.2em]">Email</Label>
          <Input
            placeholder="name@company.com"
            {...inviteForm.register('email', { required: true })}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-[0.65rem] uppercase tracking-[0.2em]">Avatar URL</Label>
          <Input placeholder="https://" {...inviteForm.register('avatarUrl')} />
        </div>
        <div className="space-y-2">
          <Label className="text-[0.65rem] uppercase tracking-[0.2em]">Role</Label>
          <NativeSelect {...inviteForm.register('role')} className="w-full">
            {roleOptions.map((role) => (
              <NativeSelectOption key={role} value={role}>
                {role}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <Button className="w-full" type="submit" disabled={inviteMember.isPending}>
          {inviteMember.isPending ? 'Sending' : 'Send invite'}
        </Button>
      </form>

      {statusText ? (
        <div className="rounded-lg border border-border/50 bg-muted/40 px-3 py-2 text-[0.65rem] text-muted-foreground">
          {statusText}
        </div>
      ) : null}

      {inviteUrl ? (
        <div className="space-y-2">
          <Label className="text-[0.65rem] uppercase tracking-[0.2em]">Invite link</Label>
          <div className="flex items-center gap-2">
            <Input value={inviteUrl} readOnly />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard?.writeText(inviteUrl)
              }}
            >
              Copy
            </Button>
          </div>
          <p className="text-[0.65rem] text-muted-foreground">
            Share this link directly if email delivery is still being set up.
          </p>
        </div>
      ) : null}
    </div>
  )
}
