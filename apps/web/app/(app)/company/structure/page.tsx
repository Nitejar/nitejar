import { createPageMetadata } from '@/app/metadata'
import { CompanyPageShell } from '../CompanyPageShell'

export const dynamic = 'force-dynamic'
export const metadata = createPageMetadata('Company Structure')

export default function CompanyStructurePage() {
  return <CompanyPageShell />
}
