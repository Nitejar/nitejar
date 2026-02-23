'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { trpc } from '@/lib/trpc'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MembersSection } from './MembersSection'
import { TeamsSection } from './TeamsSection'
import { AccessSection } from './AccessSection'

export function OrganizationClient() {
  const searchParams = useSearchParams()
  const initialTab = searchParams.get('tab') ?? 'members'
  const [tab, setTab] = useState(initialTab)

  const { data: membersData } = trpc.org.listMembers.useQuery()
  const { data: teamsData } = trpc.org.listTeams.useQuery()

  const memberCount = membersData?.length ?? 0
  const teamCount = teamsData?.length ?? 0

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList variant="line">
        <TabsTrigger value="members">
          Members
          {memberCount > 0 && (
            <Badge variant="secondary" className="ml-1.5 h-5 min-w-5 px-1.5 text-[0.6rem]">
              {memberCount}
            </Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="teams">
          Teams
          {teamCount > 0 && (
            <Badge variant="secondary" className="ml-1.5 h-5 min-w-5 px-1.5 text-[0.6rem]">
              {teamCount}
            </Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="access">Access Policy</TabsTrigger>
      </TabsList>

      <TabsContent value="members" className="mt-4">
        <MembersSection />
      </TabsContent>

      <TabsContent value="teams" className="mt-4">
        <TeamsSection />
      </TabsContent>

      <TabsContent value="access" className="mt-4">
        <AccessSection />
      </TabsContent>
    </Tabs>
  )
}
