import loadable from 'next/dynamic'
import { createPageMetadata } from '@/app/metadata'
import { PageHeader } from '../../components/PageHeader'
import { ClientErrorBoundary } from '../../components/ClientErrorBoundary'
import { PageScrollShell } from '../../components/PageScrollShell'
import { RouteClientFallback } from '../../components/RouteClientFallback'

const ReviewsClient = loadable(() => import('./ReviewsClient').then((mod) => mod.ReviewsClient), {
  loading: () => <RouteClientFallback label="Loading schema reviews..." />,
})

export const metadata = createPageMetadata('Schema Reviews')

export default function SchemaReviewsPage() {
  return (
    <PageScrollShell className="space-y-6">
      <PageHeader
        title="Schema Reviews"
        description="Review and approve collection schema proposals from agents."
        backLink={{ href: '/collections', label: 'Collections' }}
      />

      <ClientErrorBoundary label="Schema Reviews">
        <ReviewsClient />
      </ClientErrorBoundary>
    </PageScrollShell>
  )
}
