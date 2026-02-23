'use client'

import { useCallback, useState } from 'react'
import { IconDownload, IconLoader2 } from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

interface ExportProfileButtonProps {
  agentId: string
  agentHandle: string
}

export function ExportProfileButton({ agentId, agentHandle }: ExportProfileButtonProps) {
  const [exporting, setExporting] = useState(false)
  const utils = trpc.useUtils()

  const handleExport = useCallback(async () => {
    setExporting(true)
    try {
      const profile = await utils.org.exportAgentProfile.fetch({
        agentId,
        includeSeedMemories: true,
      })
      const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${agentHandle}.nitejar-agent.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success('Profile exported')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }, [agentId, agentHandle, utils])

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void handleExport()}
      disabled={exporting}
      className="text-xs"
    >
      {exporting ? (
        <IconLoader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      ) : (
        <IconDownload className="mr-1.5 h-3.5 w-3.5" />
      )}
      Export Profile
    </Button>
  )
}
