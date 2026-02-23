'use client'

import { useMemo, useState } from 'react'
import { IconArrowDown, IconArrowUp, IconPlus, IconSearch } from '@tabler/icons-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export interface CredentialTableRow {
  id: string
  alias: string
  provider: string
  allowedHosts: string[]
  allowedInHeader: boolean
  allowedInQuery: boolean
  allowedInBody: boolean
  enabled: boolean
  agents: Array<{ id: string; name: string }>
  lastUsedAt?: number | null
  lastStatus?: 'success' | 'fail' | 'denied' | null
  totalCalls?: number
}

type SortKey =
  | 'alias'
  | 'provider'
  | 'agents'
  | 'totalCalls'
  | 'enabled'
  | 'lastUsed'
  | 'lastStatus'

const STATUS_RANK: Record<string, number> = { success: 3, fail: 2, denied: 1, none: 0 }

function formatDate(unix: number | null | undefined): string {
  if (!unix) return 'Never'
  return new Date(unix * 1000).toLocaleString()
}

function statusBadgeClass(status: CredentialTableRow['lastStatus']): string {
  if (status === 'success') return 'border-emerald-500/40 text-emerald-300'
  if (status === 'fail') return 'border-rose-500/40 text-rose-300'
  if (status === 'denied') return 'border-amber-500/40 text-amber-300'
  return 'border-white/10 text-muted-foreground'
}

interface CredentialTableProps {
  credentials: CredentialTableRow[]
  selectedCredentialId: string | null
  onSelectCredential: (credentialId: string) => void
  onNewCredential: () => void
}

export function CredentialTable({
  credentials,
  selectedCredentialId,
  onSelectCredential,
  onNewCredential,
}: CredentialTableProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('lastUsed')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function toggleSort(key: SortKey) {
    if (sortBy === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(key)
      setSortDir(key === 'alias' || key === 'provider' ? 'asc' : 'desc')
    }
  }

  const rows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return credentials
      .filter(
        (c) => !q || c.alias.toLowerCase().includes(q) || c.provider.toLowerCase().includes(q)
      )
      .sort((a, b) => {
        let cmp = 0
        switch (sortBy) {
          case 'alias':
            cmp = a.alias.localeCompare(b.alias)
            break
          case 'provider':
            cmp = a.provider.localeCompare(b.provider)
            break
          case 'agents':
            cmp = a.agents.length - b.agents.length
            break
          case 'totalCalls':
            cmp = (a.totalCalls ?? 0) - (b.totalCalls ?? 0)
            break
          case 'enabled':
            cmp = Number(a.enabled) - Number(b.enabled)
            break
          case 'lastUsed':
            cmp = (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0)
            break
          case 'lastStatus':
            cmp =
              (STATUS_RANK[a.lastStatus ?? 'none'] ?? 0) -
              (STATUS_RANK[b.lastStatus ?? 'none'] ?? 0)
            break
        }
        if (cmp === 0) cmp = a.alias.localeCompare(b.alias)
        return sortDir === 'asc' ? cmp : -cmp
      })
  }, [credentials, searchQuery, sortBy, sortDir])

  function SortHeader({
    label,
    sortKey,
    className,
  }: {
    label: string
    sortKey: SortKey
    className?: string
  }) {
    const active = sortBy === sortKey
    return (
      <th
        className={`cursor-pointer select-none px-3 py-2 font-medium transition-colors hover:text-white/90 ${className ?? ''}`}
        onClick={() => toggleSort(sortKey)}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {active &&
            (sortDir === 'asc' ? (
              <IconArrowUp className="h-3 w-3" />
            ) : (
              <IconArrowDown className="h-3 w-3" />
            ))}
        </span>
      </th>
    )
  }

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Credential Vault</CardTitle>
          <Button variant="secondary" onClick={onNewCredential}>
            <IconPlus className="mr-2 h-4 w-4" />
            New Credential
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <IconSearch className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by alias or provider..."
            className="pl-9"
          />
        </div>

        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {credentials.length === 0 ? 'No credentials yet.' : 'No credentials match your search.'}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-white/10">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="bg-white/[0.03] text-muted-foreground">
                <tr>
                  <SortHeader label="Alias" sortKey="alias" />
                  <SortHeader label="Provider" sortKey="provider" />
                  <SortHeader label="Agents" sortKey="agents" />
                  <SortHeader label="Calls (30d)" sortKey="totalCalls" />
                  <SortHeader label="Enabled" sortKey="enabled" />
                  <SortHeader label="Last Used" sortKey="lastUsed" />
                  <SortHeader label="Last Status" sortKey="lastStatus" />
                </tr>
              </thead>
              <tbody>
                {rows.map((credential) => {
                  const active = credential.id === selectedCredentialId
                  return (
                    <tr
                      key={credential.id}
                      className={`cursor-pointer border-t border-white/5 transition-colors ${
                        active ? 'bg-emerald-500/10' : 'hover:bg-white/[0.03]'
                      }`}
                      onClick={() => onSelectCredential(credential.id)}
                    >
                      <td className="px-3 py-2 font-medium text-white/90">{credential.alias}</td>
                      <td className="px-3 py-2 text-white/80">{credential.provider}</td>
                      <td className="px-3 py-2 text-white/70">{credential.agents.length}</td>
                      <td className="px-3 py-2 text-white/70">{credential.totalCalls ?? 0}</td>
                      <td className="px-3 py-2">
                        <Badge
                          variant="outline"
                          className={
                            credential.enabled
                              ? 'border-emerald-500/40 text-emerald-300'
                              : 'border-white/10 text-muted-foreground'
                          }
                        >
                          {credential.enabled ? 'Enabled' : 'Disabled'}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-white/70">
                        {formatDate(credential.lastUsedAt)}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          variant="outline"
                          className={statusBadgeClass(credential.lastStatus)}
                        >
                          {credential.lastStatus ?? 'none'}
                        </Badge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
