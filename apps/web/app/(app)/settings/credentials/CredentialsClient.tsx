'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { trpc } from '@/lib/trpc'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { CredentialTable, type CredentialTableRow } from './CredentialTable'
import {
  CredentialForm,
  type CredentialFormAgent,
  type CredentialFormCredential,
} from './CredentialForm'

export function CredentialsClient() {
  const searchParams = useSearchParams()
  const fromParam = searchParams.get('from')

  const utils = trpc.useUtils()
  const credentialsQuery = trpc.credentials.list.useQuery()
  const agentsQuery = trpc.org.listAgents.useQuery()

  const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(null)
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null)
  const [wizardDirty, setWizardDirty] = useState(false)

  const credentials = useMemo(
    () => (credentialsQuery.data ?? []) as CredentialTableRow[],
    [credentialsQuery.data]
  )

  const selectedCredential = useMemo(
    () => credentials.find((c) => c.id === selectedCredentialId) ?? null,
    [credentials, selectedCredentialId]
  )

  const formCredential = useMemo((): CredentialFormCredential | null => {
    if (modalMode !== 'edit' || !selectedCredential) return null
    return {
      id: selectedCredential.id,
      alias: selectedCredential.alias,
      provider: selectedCredential.provider,
      allowedHosts: selectedCredential.allowedHosts,
      enabled: selectedCredential.enabled,
      allowedInHeader: selectedCredential.allowedInHeader,
      allowedInQuery: selectedCredential.allowedInQuery,
      allowedInBody: selectedCredential.allowedInBody,
      agents: selectedCredential.agents,
    }
  }, [modalMode, selectedCredential])

  const agents = useMemo(
    () =>
      (agentsQuery.data ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        handle: a.handle,
        emoji: a.emoji,
      })) as CredentialFormAgent[],
    [agentsQuery.data]
  )

  function confirmDiscard(): boolean {
    if (!wizardDirty) return true
    return window.confirm('Discard unsaved changes?')
  }

  function selectCredential(credentialId: string) {
    if (credentialId === selectedCredentialId && modalMode === 'edit') return
    if (!confirmDiscard()) return
    setSelectedCredentialId(credentialId)
    setModalMode('edit')
  }

  function startCreate() {
    if (!confirmDiscard()) return
    setSelectedCredentialId(null)
    setModalMode('create')
  }

  function closeModal() {
    if (!confirmDiscard()) return
    setModalMode(null)
    setWizardDirty(false)
  }

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!wizardDirty || !modalMode) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [wizardDirty, modalMode])

  return (
    <div className="space-y-4">
      {fromParam && (
        <Card className="border-white/10 bg-white/[0.02]">
          <CardContent className="py-3 text-xs text-muted-foreground">
            Opened from plugin setup. After saving, you can return to{' '}
            <Link href={fromParam} className="text-primary hover:underline">
              your plugin flow
            </Link>
            .
          </CardContent>
        </Card>
      )}

      <CredentialTable
        credentials={credentials}
        selectedCredentialId={selectedCredentialId}
        onSelectCredential={selectCredential}
        onNewCredential={startCreate}
      />

      <Dialog
        open={modalMode !== null}
        onOpenChange={(open) => {
          if (!open) closeModal()
        }}
      >
        <DialogContent className="max-h-[90vh] sm:max-w-2xl">
          <div className="max-h-[calc(90vh-2rem)] overflow-y-auto px-1">
            <CredentialForm
              key={`${modalMode ?? 'none'}:${selectedCredentialId ?? 'new'}`}
              credential={formCredential}
              agents={agents}
              onSaved={async (credentialId) => {
                await utils.credentials.list.invalidate()
                setSelectedCredentialId(credentialId)
                setWizardDirty(false)
                setModalMode(null)
              }}
              onDeleted={async () => {
                await utils.credentials.list.invalidate()
                setSelectedCredentialId(null)
                setWizardDirty(false)
                setModalMode(null)
              }}
              onCancel={closeModal}
              onDirtyChange={setWizardDirty}
              onCheckAlias={async (alias, excludeCredentialId) => {
                const result = await utils.credentials.checkAlias.fetch({
                  alias,
                  excludeCredentialId,
                })
                return result.available
              }}
            />
          </div>
        </DialogContent>
      </Dialog>

      {(credentialsQuery.isLoading || agentsQuery.isLoading) && (
        <p className="text-xs text-muted-foreground">Loading...</p>
      )}
    </div>
  )
}
