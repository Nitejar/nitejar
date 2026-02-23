import Link from 'next/link'
import { SkillDetailClient } from './SkillDetailClient'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function SkillDetailPage({ params }: Props) {
  const { id } = await params

  return (
    <div className="space-y-6">
      <div>
        <Link href="/skills" className="text-xs text-muted-foreground hover:text-foreground">
          &larr; Back to Skills
        </Link>
      </div>
      <SkillDetailClient skillId={id} />
    </div>
  )
}
