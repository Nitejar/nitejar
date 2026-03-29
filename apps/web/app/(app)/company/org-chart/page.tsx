import { createPageMetadata } from '@/app/metadata'
import { CompanyPageShell } from '../CompanyPageShell'

export const dynamic = 'force-dynamic'
export const metadata = createPageMetadata('Company Org Chart')

export default function CompanyOrgChartPage() {
  return <CompanyPageShell activeViewId="org_chart" />
}
