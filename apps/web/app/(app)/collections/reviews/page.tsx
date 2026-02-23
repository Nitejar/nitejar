import { PageHeader } from '../../components/PageHeader'
import { ClientErrorBoundary } from '../../components/ClientErrorBoundary'
import { ReviewsClient } from './ReviewsClient'

export default function SchemaReviewsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Schema Reviews"
        description="Review and approve collection schema proposals from agents."
        backLink={{ href: '/collections', label: 'Collections' }}
      />

      <ClientErrorBoundary label="Schema Reviews">
        <ReviewsClient />
      </ClientErrorBoundary>
    </div>
  )
}
