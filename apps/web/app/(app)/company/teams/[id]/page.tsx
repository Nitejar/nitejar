import type { Metadata } from 'next'
import { Suspense } from 'react'
import { findTeamById } from '@nitejar/database'
import { createPageMetadata } from '@/app/metadata'
import { ClientErrorBoundary } from '../../../components/ClientErrorBoundary'
import { PageScrollShell } from '../../../components/PageScrollShell'
import { SkeletonTeamDetail } from '@/app/(app)/work/skeletons'
import { TeamDetailClient } from './TeamDetailClient'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const team = await findTeamById(id)
  return createPageMetadata(team?.name ?? 'Team')
}

export default async function TeamDetailPage({ params }: Props) {
  const { id } = await params
  return (
    <ClientErrorBoundary label="Team Detail">
      <Suspense
        fallback={
          <PageScrollShell className="">
            <SkeletonTeamDetail />
          </PageScrollShell>
        }
      >
        <PageScrollShell className="">
          <TeamDetailClient teamId={id} />
        </PageScrollShell>
      </Suspense>
    </ClientErrorBoundary>
  )
}
