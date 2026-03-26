import Link from 'next/link'
import { createPageMetadata } from '@/app/metadata'
import { PageScrollShell } from '../../components/PageScrollShell'
import { SkillBuilderClient } from './SkillBuilderClient'

export const dynamic = 'force-dynamic'
export const metadata = createPageMetadata('New Skill')

export default function NewSkillPage() {
  return (
    <PageScrollShell className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/skills" className="text-xs text-muted-foreground hover:text-foreground">
            &larr; Back to Skills
          </Link>
          <h2 className="text-2xl font-semibold">Create Skill</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Build a new skill to teach your agents. A skill is a SKILL.md file with optional
            supporting files.
          </p>
        </div>
      </div>

      <SkillBuilderClient />
    </PageScrollShell>
  )
}
