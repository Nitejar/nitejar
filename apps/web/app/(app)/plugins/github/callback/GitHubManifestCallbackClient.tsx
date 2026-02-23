'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { trpc } from '@/lib/trpc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { IconCircleCheck, IconAlertTriangle, IconLoader2 } from '@tabler/icons-react'
import { cn } from '@/lib/utils'

function backHref(state: string | null) {
  return state ? `/plugins/instances/${state}` : '/plugins/github'
}

export function GitHubManifestCallbackClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const hasTriggered = useRef(false)

  const exchangeMutation = trpc.github.exchangeCode.useMutation({
    onSuccess: () => {
      setTimeout(() => {
        router.replace(backHref(state))
      }, 1500)
    },
  })

  useEffect(() => {
    if (!code || !state) return
    if (hasTriggered.current) return
    hasTriggered.current = true

    exchangeMutation.mutate({
      pluginInstanceId: state,
      code,
    })
  }, [code, state, exchangeMutation])

  if (!code || !state) {
    return (
      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader>
          <CardTitle className="text-base">Missing GitHub Callback Data</CardTitle>
          <CardDescription>
            The manifest exchange code or state parameter was not provided.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/plugins" className={cn(buttonVariants({ size: 'sm' }), 'h-8 text-xs')}>
            Return to plugins
          </Link>
        </CardContent>
      </Card>
    )
  }

  if (exchangeMutation.isPending) {
    return (
      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IconLoader2 className="h-4 w-4 animate-spin" />
            Completing GitHub Registration
          </CardTitle>
          <CardDescription>Saving credentials and finalizing setup...</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (exchangeMutation.error) {
    return (
      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-red-300">
            <IconAlertTriangle className="h-4 w-4" />
            GitHub Registration Failed
          </CardTitle>
          <CardDescription>{exchangeMutation.error.message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href={backHref(state)}
            className={cn(buttonVariants({ size: 'sm' }), 'h-8 text-xs')}
          >
            Return to plugin setup
          </Link>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-emerald-300">
          <IconCircleCheck className="h-4 w-4" />
          GitHub App Connected
        </CardTitle>
        <CardDescription>
          The GitHub App credentials have been saved. Redirecting...
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Link
          href={backHref(state)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Click here if not redirected automatically
        </Link>
      </CardContent>
    </Card>
  )
}
