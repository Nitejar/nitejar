import type { Metadata } from 'next'
import Link from 'next/link'
import { findSkillById } from '@nitejar/database'
import { createPageMetadata } from '@/app/metadata'
import { PageScrollShell } from '../../components/PageScrollShell'
import { SkillDetailClient } from './SkillDetailClient'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const skill = await findSkillById(id)
  return createPageMetadata(skill?.name ?? 'Skill')
}

export default async function SkillDetailPage({ params }: Props) {
  const { id } = await params

  return (
    <PageScrollShell className="space-y-6">
      <div>
        <Link href="/skills" className="text-xs text-muted-foreground hover:text-foreground">
          &larr; Back to Skills
        </Link>
      </div>
      <SkillDetailClient skillId={id} />
    </PageScrollShell>
  )
}
