import { createPageMetadata } from '@/app/metadata'
import { PageHeader } from '@/app/(app)/components/PageHeader'
import { PageScrollShell } from '@/app/(app)/components/PageScrollShell'
import { CapabilitiesClient } from './CapabilitiesClient'

export const metadata = createPageMetadata('Capabilities')

export default function CapabilitiesSettingsPage() {
  return (
    <PageScrollShell className="space-y-6">
      <PageHeader
        category="Settings"
        title="Capabilities"
        description="Configure optional capabilities like tool execution, web search, image generation, speech-to-text, and text-to-speech."
      />
      <CapabilitiesClient />
    </PageScrollShell>
  )
}
