import { Suspense } from 'react'
import { ClientErrorBoundary } from '../../../components/ClientErrorBoundary'
import { SkeletonTeamDetail } from '@/app/(app)/work/skeletons'
import { TeamDetailClient } from './TeamDetailClient'

export const dynamic = 'force-dynamic'

export default async function TeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <ClientErrorBoundary label="Team Detail">
      <Suspense fallback={<SkeletonTeamDetail />}>
        <TeamDetailClient teamId={id} />
      </Suspense>
    </ClientErrorBoundary>
  )
}
