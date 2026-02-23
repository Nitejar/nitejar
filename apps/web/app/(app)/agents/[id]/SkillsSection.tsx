'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  IconBook2,
  IconPlus,
  IconTrash,
  IconWorld,
  IconUsers,
  IconRobot,
  IconFile,
  IconFolder,
} from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

const scopeIcons = {
  global: IconWorld,
  team: IconUsers,
  agent: IconRobot,
}

// ============================================================================
// Attach Skill Dialog
// ============================================================================
function AttachSkillDialog({ agentId, onAttached }: { agentId: string; onAttached: () => void }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)

  const skillsQuery = trpc.skills.list.useQuery(
    { search: search || undefined, enabled: true },
    { enabled: open }
  )

  const assignMutation = trpc.skills.assign.useMutation({
    onSuccess: () => {
      setOpen(false)
      setSearch('')
      setError(null)
      onAttached()
    },
    onError: (err) => {
      setError(err.message)
    },
  })

  const skills = skillsQuery.data ?? []

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button
            type="button"
            className="rounded-md border border-primary/40 bg-primary/15 px-2.5 py-1.5 text-xs font-medium text-primary transition hover:border-primary/60 hover:bg-primary/20"
          >
            <span className="flex items-center gap-1">
              <IconPlus className="h-3 w-3" />
              Attach
            </span>
          </button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Attach Skill</DialogTitle>
          <DialogDescription>Search and select a skill to attach to this agent.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            placeholder="Search skills..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="text-xs"
          />

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="max-h-64 space-y-1 overflow-y-auto">
            {skillsQuery.isLoading && (
              <p className="py-4 text-center text-xs text-muted-foreground">Loading skills...</p>
            )}

            {!skillsQuery.isLoading && skills.length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">
                {search ? 'No skills match your search.' : 'No skills available.'}
              </p>
            )}

            {skills.map((skill) => (
              <button
                key={skill.id}
                type="button"
                onClick={() => {
                  setError(null)
                  assignMutation.mutate({
                    skillId: skill.id,
                    scope: 'agent',
                    scopeId: agentId,
                  })
                }}
                disabled={assignMutation.isPending}
                className="flex w-full items-center gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-2.5 text-left transition hover:border-primary/30 hover:bg-white/[0.04]"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/5">
                  {skill.is_directory ? (
                    <IconFolder className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <IconFile className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">{skill.name}</p>
                  {skill.description && (
                    <p className="truncate text-[10px] text-muted-foreground">
                      {skill.description}
                    </p>
                  )}
                </div>
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  {skill.category}
                </Badge>
              </button>
            ))}
          </div>
        </div>

        <DialogFooter>
          <p className="text-[10px] text-muted-foreground">
            Or{' '}
            <Link href="/skills/new" className="text-primary hover:underline">
              create a new skill
            </Link>
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// Skills Section for Agent Detail
// ============================================================================
export function SkillsSection({ agentId }: { agentId: string }) {
  const utils = trpc.useUtils()

  const assignmentsQuery = trpc.skills.listForAgent.useQuery({ agentId })

  const removeAssignmentMutation = trpc.skills.removeAssignment.useMutation({
    onSuccess: () => {
      void utils.skills.listForAgent.invalidate({ agentId })
    },
  })

  const updateAssignmentMutation = trpc.skills.updateAssignment.useMutation({
    onSuccess: () => {
      void utils.skills.listForAgent.invalidate({ agentId })
    },
  })

  const assignments = assignmentsQuery.data ?? []

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <IconBook2 className="h-4 w-4 text-muted-foreground" />
            Skills
          </CardTitle>
          <CardDescription className="text-xs">
            {assignments.length > 0
              ? `${assignments.length} skill${assignments.length !== 1 ? 's' : ''} attached`
              : 'Knowledge and workflows available to this agent.'}
          </CardDescription>
        </div>
        <AttachSkillDialog
          agentId={agentId}
          onAttached={() => void utils.skills.listForAgent.invalidate({ agentId })}
        />
      </CardHeader>
      <CardContent>
        {assignmentsQuery.isLoading ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Loading skills...</p>
        ) : assignments.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-white/10 py-6">
            <p className="text-sm text-muted-foreground">No skills attached</p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              Skills teach your agent how to do things.
            </p>
            <Link href="/skills" className="mt-2 text-xs text-primary hover:underline">
              Browse skill catalog &rarr;
            </Link>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="rounded-md border border-white/10">
              {assignments.map((assignment, idx) => {
                const skill =
                  'skill' in assignment
                    ? ((assignment as Record<string, unknown>).skill as {
                        id: string
                        name: string
                        slug: string
                        description: string | null
                        category: string
                        source_kind: string
                        is_directory: number
                      } | null)
                    : null
                const ScopeIcon =
                  scopeIcons[assignment.scope as keyof typeof scopeIcons] ?? IconWorld
                const isInherited = assignment.scope !== 'agent'

                return (
                  <div
                    key={assignment.id}
                    className={`group flex items-center gap-2 px-2.5 py-1.5 ${idx > 0 ? 'border-t border-white/5' : ''}`}
                  >
                    <ScopeIcon
                      className="h-3 w-3 shrink-0 text-muted-foreground"
                      title={`${assignment.scope}${isInherited ? ' (inherited)' : ''}`}
                    />

                    <div className="min-w-0 flex-1">
                      {skill ? (
                        <Link
                          href={`/skills/${skill.id}`}
                          className="block truncate text-xs font-medium hover:text-primary"
                          title={skill.description ?? undefined}
                        >
                          {skill.name}
                        </Link>
                      ) : (
                        <span className="block truncate text-xs font-medium">
                          {assignment.skill_slug}
                        </span>
                      )}
                    </div>

                    {/* Auto-inject toggle */}
                    {!isInherited && (
                      <div className="flex shrink-0 items-center gap-1">
                        <span className="text-[10px] text-muted-foreground">auto</span>
                        <Switch
                          size="sm"
                          checked={assignment.auto_inject === 1}
                          onCheckedChange={(val) =>
                            updateAssignmentMutation.mutate({
                              assignmentId: assignment.id,
                              autoInject: val,
                            })
                          }
                        />
                      </div>
                    )}

                    {isInherited && (
                      <span className="shrink-0 text-[10px] text-muted-foreground/50">
                        inherited
                      </span>
                    )}

                    {/* Remove */}
                    {!isInherited && (
                      <button
                        type="button"
                        className="shrink-0 p-0.5 text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100"
                        onClick={() =>
                          removeAssignmentMutation.mutate({
                            assignmentId: assignment.id,
                          })
                        }
                        disabled={removeAssignmentMutation.isPending}
                        title="Remove skill"
                      >
                        <IconTrash className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>

            <Link
              href="/skills"
              className="block pt-1 text-center text-[10px] text-muted-foreground hover:text-foreground"
            >
              Manage skills &rarr;
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
