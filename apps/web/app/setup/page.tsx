import { redirect } from 'next/navigation'
import { getDb } from '@nitejar/database'
import { bootstrapFirstUserAction } from '@/app/actions/auth'
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

export default async function SetupPage({ searchParams }: PageProps) {
  const totalUsers = await countUsers()

  if (totalUsers > 0) {
    redirect('/login')
  }

  const params = await searchParams
  const error = typeof params.error === 'string' ? params.error : null

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Create your first user</CardTitle>
          <CardDescription>
            This Nitejar install has no users yet. Set up the initial superadmin account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form action={bootstrapFirstUserAction} className="space-y-4">
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
              Create superadmin
            </Button>
          </form>

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
