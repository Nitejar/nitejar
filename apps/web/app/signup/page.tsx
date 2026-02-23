import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getDb } from '@nitejar/database'
import { signUpApprovedDomainAction } from '@/app/actions/auth'
import { getServerSession } from '@/lib/auth-server'
import { getAuthSignupPolicy } from '@/server/services/auth-signup-policy'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

async function countUsers(): Promise<number> {
  const db = getDb()
  const result = await db
    .selectFrom('users')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .executeTakeFirst()

  return Number(result?.count ?? 0)
}

export default async function SignupPage({ searchParams }: PageProps) {
  if ((await countUsers()) === 0) {
    redirect('/setup')
  }

  const session = await getServerSession()
  if (session) {
    redirect('/')
  }

  const policy = await getAuthSignupPolicy()
  if (policy.mode !== 'approved_domain') {
    redirect('/login')
  }

  const params = await searchParams
  const error = typeof params.error === 'string' ? params.error : null

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Create your account</CardTitle>
          <CardDescription>Self-signup is enabled for approved email domains only.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form action={signUpApprovedDomainAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required autoComplete="name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required autoComplete="email" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="avatarUrl">Avatar URL (optional)</Label>
              <Input id="avatarUrl" name="avatarUrl" type="url" placeholder="https://" />
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
              Create account
            </Button>
          </form>

          {error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}

          <p className="text-xs text-muted-foreground">
            Already have an account?{' '}
            <Link href="/login" className="underline">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
