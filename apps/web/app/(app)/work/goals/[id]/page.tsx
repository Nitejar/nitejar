import { PageHeader } from '@/app/(app)/components/PageHeader'
import { GoalDetailClient } from './GoalDetailClient'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function GoalDetailPage({ params }: Props) {
  const { id } = await params

  return (
    <div className="space-y-6">
      <PageHeader category="Work" title="Goal" backLink={{ href: '/work', label: 'Work' }} />
      <GoalDetailClient goalId={id} />
    </div>
  )
}
