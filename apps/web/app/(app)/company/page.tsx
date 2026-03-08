import { ClientErrorBoundary } from '../components/ClientErrorBoundary'
import { PageHeader } from '../components/PageHeader'
import { CompanyClient } from './CompanyClient'

export const dynamic = 'force-dynamic'

export default function CompanyPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        category="Company"
        title="Company"
        description="Board view for what the company is doing, how it is staffed, and where coverage is thin."
      />
      <ClientErrorBoundary label="Company">
        <CompanyClient />
      </ClientErrorBoundary>
    </div>
  )
}
