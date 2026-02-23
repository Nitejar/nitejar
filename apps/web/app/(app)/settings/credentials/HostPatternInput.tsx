'use client'

import { useMemo, useState } from 'react'
import { IconChevronRight, IconPlus, IconX } from '@tabler/icons-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const wildcardSubdomainPattern =
  /^\*\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/
const exactDomainPattern =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/

export function isValidHostPattern(pattern: string): boolean {
  const value = pattern.trim()
  if (!value) return false
  if (value === '*') return true
  return wildcardSubdomainPattern.test(value) || exactDomainPattern.test(value)
}

export function isHostAllowedByPatterns(host: string, patterns: string[]): boolean {
  const normalizedHost = host.toLowerCase()
  return patterns.some((pattern) => {
    const normalizedPattern = pattern.toLowerCase()
    if (normalizedPattern === '*') return true
    if (normalizedPattern.startsWith('*.')) {
      return normalizedHost.endsWith(normalizedPattern.slice(1))
    }
    return normalizedHost === normalizedPattern
  })
}

interface HostPatternInputProps {
  hosts: string[]
  onChange: (hosts: string[]) => void
}

const EXAMPLE_HOSTS = [
  { label: 'graph.facebook.com', desc: 'Meta / Instagram Graph API' },
  { label: 'api.github.com', desc: 'GitHub REST API' },
  { label: 'api.openai.com', desc: 'OpenAI API' },
  { label: 'api.stripe.com', desc: 'Stripe API' },
]

export function HostPatternInput({ hosts, onChange }: HostPatternInputProps) {
  const [incomingHost, setIncomingHost] = useState('')
  const [testUrl, setTestUrl] = useState('')
  const [showTestUrl, setShowTestUrl] = useState(false)

  const invalidHosts = useMemo(() => hosts.filter((host) => !isValidHostPattern(host)), [hosts])

  const hostTestResult = useMemo(() => {
    const trimmed = testUrl.trim()
    if (!trimmed) return null
    try {
      const parsed = new URL(trimmed)
      const allowed = isHostAllowedByPatterns(parsed.hostname, hosts)
      return {
        host: parsed.hostname,
        allowed,
      }
    } catch {
      return {
        host: '',
        allowed: false,
        invalid: true,
      } as const
    }
  }, [hosts, testUrl])

  const addHost = () => {
    const trimmed = incomingHost.trim()
    if (!trimmed) return
    if (hosts.includes(trimmed)) {
      setIncomingHost('')
      return
    }
    onChange([...hosts, trimmed])
    setIncomingHost('')
  }

  const removeHost = (target: string) => {
    onChange(hosts.filter((host) => host !== target))
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="cred-allowed-hosts">Allowed Hosts</Label>
        <p className="text-xs text-muted-foreground">
          Domains this credential can reach. Exact match or wildcard (e.g.{' '}
          <code>graph.facebook.com</code>, <code>*.example.com</code>).
        </p>
      </div>

      <div className="flex gap-2">
        <Input
          id="cred-allowed-hosts"
          value={incomingHost}
          placeholder="api.example.com"
          onChange={(event) => setIncomingHost(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              addHost()
            }
          }}
        />
        <Button type="button" variant="outline" onClick={addHost}>
          <IconPlus className="mr-1 h-3.5 w-3.5" />
          Add
        </Button>
      </div>

      {hosts.length === 0 ? (
        <div className="space-y-2">
          <p className="text-xs text-amber-300">Add at least one host pattern.</p>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLE_HOSTS.filter((ex) => !hosts.includes(ex.label)).map((ex) => (
              <button
                key={ex.label}
                type="button"
                className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white/80"
                onClick={() => onChange([...hosts, ex.label])}
                title={ex.desc}
              >
                + {ex.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {hosts.map((host) => {
            const valid = isValidHostPattern(host)
            return (
              <Badge
                key={host}
                variant="outline"
                className={`gap-1 pr-1 ${
                  valid ? 'border-white/20 text-white/80' : 'border-rose-400/60 text-rose-200'
                }`}
              >
                <span>{host}</span>
                <button
                  type="button"
                  onClick={() => removeHost(host)}
                  className="rounded p-0.5 hover:bg-white/10"
                  aria-label={`Remove ${host}`}
                >
                  <IconX className="h-3 w-3" />
                </button>
              </Badge>
            )
          })}
        </div>
      )}

      {invalidHosts.length > 0 && (
        <p className="text-xs text-rose-300">
          Invalid host pattern{invalidHosts.length === 1 ? '' : 's'}:{' '}
          {invalidHosts.map((host) => `\`${host}\``).join(', ')}
        </p>
      )}

      <div>
        <button
          type="button"
          onClick={() => setShowTestUrl(!showTestUrl)}
          className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-white/70"
        >
          <IconChevronRight
            className={`h-3 w-3 transition-transform ${showTestUrl ? 'rotate-90' : ''}`}
          />
          Test URL against policy
        </button>
        {showTestUrl && (
          <div className="mt-2 space-y-2 rounded-md border border-white/10 bg-black/20 p-3">
            <Input
              id="host-policy-test"
              value={testUrl}
              placeholder="https://api.example.com/v1/status"
              onChange={(event) => setTestUrl(event.target.value)}
            />
            {hostTestResult ? (
              hostTestResult.invalid ? (
                <p className="text-xs text-rose-300">Enter a valid URL (http/https).</p>
              ) : hostTestResult.allowed ? (
                <p className="text-xs text-emerald-300">
                  Allowed: `{hostTestResult.host}` matches current policy.
                </p>
              ) : (
                <p className="text-xs text-amber-300">
                  Blocked: `{hostTestResult.host}` does not match current policy.
                </p>
              )
            ) : (
              <p className="text-xs text-muted-foreground">
                Paste a URL to verify it matches the host allowlist.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
