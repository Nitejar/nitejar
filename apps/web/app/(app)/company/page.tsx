import { createPageMetadata } from '@/app/metadata'
import { CompanyPageShell } from './CompanyPageShell'

export const dynamic = 'force-dynamic'
export const metadata = createPageMetadata('Company')

export default function CompanyPage() {
  return <CompanyPageShell />
}
