import { createPageMetadata } from '@/app/metadata'
import { FleetPageClient } from './FleetPageClient'

export const metadata = createPageMetadata('Fleet')

export default function FleetPage() {
  return <FleetPageClient />
}
