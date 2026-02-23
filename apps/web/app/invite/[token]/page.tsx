import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getDb } from '@nitejar/database'
import { acceptInviteAction } from '@/app/actions/auth'
import { hashInviteToken } from '@/lib/invitations'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

type PageProps = {
  params: Promise<{ token: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function InvitePage({ params, searchParams }: PageProps) {
  const { token } = await params
  const tokenHash = hashInviteToken(token)
  const db = getDb()

  const invite = await db
    .selectFrom('invitations')
    .selectAll()
    .where('token_hash', '=', tokenHash)
    .where('status', '=', 'pending')
    .executeTakeFirst()

  if (!invite) {
    notFound()
  }

  const now = Math.floor(Date.now() / 1000)
  const expired = Boolean(invite.expires_at && invite.expires_at < now)

  const paramsObj = await searchParams
  const error = typeof paramsObj.error === 'string' ? paramsObj.error : null

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Accept invite</CardTitle>
          <CardDescription>
            Create your account for <strong>{invite.email}</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {expired ? (
            <div className="space-y-2">
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                This invite has expired.
              </p>
              <Link href="/login" className="text-xs underline">
                Go to login
              </Link>
            </div>
          ) : (
            <form action={acceptInviteAction.bind(null, token)} className="space-y-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={invite.name} readOnly />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={invite.email} readOnly />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" name="password" type="password" required minLength={8} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm password</Label>
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  required
                  minLength={8}
                />
              </div>
              <Button type="submit" className="w-full">
                Accept invite
              </Button>
            </form>
          )}

          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
