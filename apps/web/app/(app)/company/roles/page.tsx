import { createPageMetadata } from '@/app/metadata'
import { CompanyPageShell } from '../CompanyPageShell'

export const dynamic = 'force-dynamic'
export const metadata = createPageMetadata('Company Roles')

export default function CompanyRolesPage() {
  return <CompanyPageShell />
}
