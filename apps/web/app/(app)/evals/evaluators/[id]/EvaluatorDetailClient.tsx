'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  IconRobot,
  IconTrash,
  IconDeviceFloppy,
  IconPlus,
  IconAlertTriangle,
} from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

const TYPE_LABELS: Record<string, string> = {
  llm_judge: 'LLM Judge',
  programmatic: 'Programmatic',
  statistical: 'Statistical',
  safety: 'Safety',
  human_feedback: 'Human Feedback',
  task_completion: 'Task Completion',
  custom: 'Custom',
}

interface ScaleDescriptions {
  1: string
  2: string
  3: string
  4: string
  5: string
}

interface Criterion {
  id: string
  name: string
  description: string
  weight: number
  scale: ScaleDescriptions
}

function totalWeight(criteria: Criterion[]): number {
  return criteria.reduce((sum, c) => sum + c.weight, 0)
}

function weightPercent(weight: number, total: number): string {
  if (total === 0) return '0%'
  return ((weight / total) * 100).toFixed(0) + '%'
}

function getSliderWeight(value: unknown, fallback: number): number {
  if (typeof value === 'number') return value
  if (Array.isArray(value) && typeof value[0] === 'number') return value[0]
  return fallback
}

export function EvaluatorDetailClient({ evaluatorId }: { evaluatorId: string }) {
  const router = useRouter()
  const utils = trpc.useUtils()

  const evaluatorQuery = trpc.evals.getEvaluator.useQuery({ id: evaluatorId })
  const evaluator = evaluatorQuery.data

  // Parse rubric ID from config
  const configJson = evaluator?.config_json
    ? (() => {
        try {
          return JSON.parse(evaluator.config_json) as { rubric_id?: string }
        } catch {
          return {}
        }
      })()
    : {}
  const rubricId = configJson.rubric_id

  const rubricQuery = trpc.evals.getRubric.useQuery({ id: rubricId! }, { enabled: !!rubricId })
  const rubric = rubricQuery.data

  // Parse criteria from rubric
  const initialCriteria: Criterion[] = rubric?.criteria_json
    ? (() => {
        try {
          return JSON.parse(rubric.criteria_json) as Criterion[]
        } catch {
          return []
        }
      })()
    : []

  const [criteria, setCriteria] = useState<Criterion[] | null>(null)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  // Use edited criteria if available, otherwise initial
  const displayCriteria = criteria ?? initialCriteria
  const tw = totalWeight(displayCriteria)

  const updateRubricMutation = trpc.evals.updateRubric.useMutation({
    onSuccess: () => {
      setStatus({ type: 'success', text: 'Rubric updated.' })
      void utils.evals.getRubric.invalidate({ id: rubricId! })
      void utils.evals.getEvaluator.invalidate({ id: evaluatorId })
      setCriteria(null) // Reset to server state
    },
    onError: (err) => {
      setStatus({ type: 'error', text: err.message })
    },
  })

  const deleteMutation = trpc.evals.deleteEvaluator.useMutation({
    onSuccess: () => {
      router.push('/evals/evaluators')
    },
    onError: (err) => {
      setStatus({ type: 'error', text: err.message })
    },
  })

  function handleSaveCriteria() {
    if (!rubricId || !criteria) return
    updateRubricMutation.mutate({
      id: rubricId,
      name: undefined,
      description: undefined,
      criteriaJson: criteria,
    })
  }

  function updateCriterion(index: number, updates: Partial<Criterion>) {
    const current = criteria ?? [...initialCriteria]
    setCriteria(current.map((c, i) => (i === index ? { ...c, ...updates } : c)))
  }

  function updateScaleLevel(criterionIndex: number, level: 1 | 2 | 3 | 4 | 5, value: string) {
    const current = criteria ?? [...initialCriteria]
    setCriteria(
      current.map((c, i) =>
        i === criterionIndex ? { ...c, scale: { ...c.scale, [level]: value } } : c
      )
    )
  }

  function removeCriterion(index: number) {
    const current = criteria ?? [...initialCriteria]
    setCriteria(current.filter((_, i) => i !== index))
  }

  function addCriterion() {
    const current = criteria ?? [...initialCriteria]
    setCriteria([
      ...current,
      {
        id: crypto.randomUUID(),
        name: '',
        description: '',
        weight: 1,
        scale: { 1: '', 2: '', 3: '', 4: '', 5: '' },
      },
    ])
  }

  if (evaluatorQuery.isLoading) {
    return <p className="py-8 text-center text-xs text-muted-foreground">Loading evaluator...</p>
  }

  if (!evaluator) {
    return <p className="py-8 text-center text-xs text-muted-foreground">Evaluator not found.</p>
  }

  const hasChanges = criteria !== null

  return (
    <div className="space-y-6">
      {status && (
        <div
          className={`rounded-lg border p-3 text-xs ${
            status.type === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
              : 'border-destructive/30 bg-destructive/10 text-destructive'
          }`}
        >
          {status.text}
        </div>
      )}

      {/* Evaluator info */}
      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/5">
              <IconRobot className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                {evaluator.name}
                <Badge variant="default" className="text-[10px]">
                  {TYPE_LABELS[evaluator.type] ?? evaluator.type}
                </Badge>
              </CardTitle>
              {evaluator.description && (
                <CardDescription className="text-xs">{evaluator.description}</CardDescription>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 text-xs">
            <div className="flex justify-between border-b border-white/5 pb-2">
              <span className="text-muted-foreground">Evaluator ID</span>
              <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px]">
                {evaluator.id.slice(0, 8)}...
              </code>
            </div>
            {evaluator.judge_model && (
              <div className="flex justify-between border-b border-white/5 pb-2">
                <span className="text-muted-foreground">Judge Model</span>
                <span className="font-mono text-[10px]">{evaluator.judge_model}</span>
              </div>
            )}
            <div className="flex justify-between border-b border-white/5 pb-2">
              <span className="text-muted-foreground">Created</span>
              <span>{new Date(evaluator.created_at * 1000).toLocaleDateString()}</span>
            </div>
            {rubricId && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Rubric ID</span>
                <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px]">
                  {rubricId.slice(0, 8)}...
                </code>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Rubric criteria editor (for llm_judge) */}
      {evaluator.type === 'llm_judge' && rubric && (
        <Card className="border-white/10 bg-white/[0.02]">
          <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
            <div>
              <CardTitle className="text-base">Rubric Criteria</CardTitle>
              <CardDescription className="text-xs">
                Edit the criteria and scale descriptions for this rubric. Version {rubric.version}.
              </CardDescription>
            </div>
            {hasChanges && (
              <Button
                size="sm"
                disabled={updateRubricMutation.isPending}
                onClick={handleSaveCriteria}
              >
                <IconDeviceFloppy className="h-3 w-3" />
                {updateRubricMutation.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {displayCriteria.map((criterion, index) => (
              <div
                key={criterion.id}
                className="rounded-lg border border-white/10 bg-white/[0.01] p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 space-y-2">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label className="text-xs">Name</Label>
                        <Input
                          value={criterion.name}
                          onChange={(e) => updateCriterion(index, { name: e.target.value })}
                          className="mt-1 text-xs"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">
                          Weight: {criterion.weight} ({weightPercent(criterion.weight, tw)})
                        </Label>
                        <div className="mt-1 flex items-center gap-3">
                          <Slider
                            value={[criterion.weight]}
                            onValueChange={(value) => {
                              updateCriterion(index, {
                                weight: getSliderWeight(value, criterion.weight),
                              })
                            }}
                            min={1}
                            max={5}
                            step={1}
                            className="flex-1"
                          />
                          <span className="w-6 text-right text-xs">{criterion.weight}</span>
                        </div>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Description</Label>
                      <Textarea
                        value={criterion.description}
                        onChange={(e) => updateCriterion(index, { description: e.target.value })}
                        className="mt-1 text-xs"
                        rows={2}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Scale (1-5)</Label>
                      <div className="mt-1 space-y-1">
                        {([1, 2, 3, 4, 5] as const).map((level) => (
                          <div key={level} className="flex items-start gap-2">
                            <span
                              className={`mt-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-medium ${
                                level <= 2
                                  ? 'bg-red-500/20 text-red-400'
                                  : level === 3
                                    ? 'bg-yellow-500/20 text-yellow-400'
                                    : 'bg-emerald-500/20 text-emerald-400'
                              }`}
                            >
                              {level}
                            </span>
                            <Input
                              value={criterion.scale[level]}
                              onChange={(e) => updateScaleLevel(index, level, e.target.value)}
                              className="text-xs"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  {displayCriteria.length > 1 && (
                    <Button variant="ghost" size="icon-xs" onClick={() => removeCriterion(index)}>
                      <IconTrash className="h-3 w-3 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            ))}

            <Button variant="outline" size="sm" onClick={addCriterion}>
              <IconPlus className="h-3 w-3" />
              Add Criterion
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Delete */}
      <Card className="border-destructive/20 bg-destructive/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-destructive">
            <IconAlertTriangle className="h-4 w-4" />
            Danger Zone
          </CardTitle>
          <CardDescription className="text-xs">
            Permanently delete this evaluator and its rubric. This also removes all agent
            assignments.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <DialogTrigger
              render={
                <button
                  type="button"
                  className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-xs font-medium text-destructive transition hover:bg-destructive/20"
                >
                  Delete Evaluator
                </button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete Evaluator</DialogTitle>
                <DialogDescription>
                  Are you sure you want to delete &quot;{evaluator.name}&quot;? This cannot be
                  undone. All agent assignments will be removed.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate({ id: evaluatorId })}
                >
                  {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </div>
  )
}
