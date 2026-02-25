import { PageHeader } from '@/app/(app)/components/PageHeader'
import { CapabilitiesClient } from './CapabilitiesClient'

export default function CapabilitiesSettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        category="Settings"
        title="Capabilities"
        description="Configure optional capabilities like tool execution, web search, image generation, speech-to-text, and text-to-speech."
      />
      <CapabilitiesClient />
    </div>
  )
}
