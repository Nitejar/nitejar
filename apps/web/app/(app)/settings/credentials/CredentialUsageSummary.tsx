'use client'

import { trpc } from '@/lib/trpc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

function formatRelativeTime(unix: number | null | undefined): string {
  if (!unix) return 'Never'
  return new Date(unix * 1000).toLocaleString()
}

function statusTone(status: 'success' | 'fail' | 'denied' | null | undefined): string {
  if (status === 'success') return 'text-emerald-300 border-emerald-500/40'
  if (status === 'fail') return 'text-rose-300 border-rose-500/40'
  if (status === 'denied') return 'text-amber-300 border-amber-500/40'
  return 'text-muted-foreground border-white/10'
}

interface CredentialUsageSummaryProps {
  credentialId: string | null
}

export function CredentialUsageSummary({ credentialId }: CredentialUsageSummaryProps) {
  const usageQuery = trpc.credentials.getUsageSummary.useQuery(
    { credentialId: credentialId ?? '', windowSeconds: 60 * 60 * 24 * 30 },
    { enabled: Boolean(credentialId) }
  )

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader>
        <CardTitle className="text-base">Usage Summary (30d)</CardTitle>
        <CardDescription>
          How to verify usage: check run receipts and external API call logs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!credentialId ? (
          <p className="text-sm text-muted-foreground">Save a credential to see usage receipts.</p>
        ) : usageQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading usage summary...</p>
        ) : usageQuery.error ? (
          <p className="text-sm text-rose-300">{usageQuery.error.message}</p>
        ) : usageQuery.data ? (
          <>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Last used</span>
              <span className="text-xs text-white/80">
                {formatRelativeTime(usageQuery.data.lastUsedAt)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Last call status</span>
              <Badge variant="outline" className={statusTone(usageQuery.data.lastStatus)}>
                {usageQuery.data.lastStatus ?? 'none'}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded border border-white/10 bg-black/20 p-2">
                <p className="text-muted-foreground">Total calls</p>
                <p className="mt-1 text-sm text-white/90">{usageQuery.data.totalCalls}</p>
              </div>
              <div className="rounded border border-white/10 bg-black/20 p-2">
                <p className="text-muted-foreground">Success</p>
                <p className="mt-1 text-sm text-emerald-300">{usageQuery.data.successCount}</p>
              </div>
              <div className="rounded border border-white/10 bg-black/20 p-2">
                <p className="text-muted-foreground">Fail</p>
                <p className="mt-1 text-sm text-rose-300">{usageQuery.data.failCount}</p>
              </div>
              <div className="rounded border border-white/10 bg-black/20 p-2">
                <p className="text-muted-foreground">Denied</p>
                <p className="mt-1 text-sm text-amber-300">{usageQuery.data.deniedCount}</p>
              </div>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
