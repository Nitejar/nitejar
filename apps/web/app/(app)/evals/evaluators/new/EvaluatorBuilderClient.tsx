'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  IconRobot,
  IconCode,
  IconChartBar,
  IconShield,
  IconUsers,
  IconChecklist,
  IconPuzzle,
  IconArrowLeft,
  IconArrowRight,
  IconPlus,
  IconTrash,
  IconTemplate,
  IconFileDescription,
} from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Slider } from '@/components/ui/slider'

// ============================================================================
// Types
// ============================================================================

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

const EVALUATOR_TYPES = [
  {
    type: 'llm_judge' as const,
    label: 'LLM Judge',
    description: 'Score runs using an LLM as judge with a rubric.',
    icon: IconRobot,
    enabled: true,
  },
  {
    type: 'programmatic' as const,
    label: 'Programmatic',
    description: 'Run code-based checks on output.',
    icon: IconCode,
    enabled: false,
  },
  {
    type: 'statistical' as const,
    label: 'Statistical',
    description: 'Compute aggregate metrics over runs.',
    icon: IconChartBar,
    enabled: false,
  },
  {
    type: 'safety' as const,
    label: 'Safety',
    description: 'Check for harmful or policy-violating output.',
    icon: IconShield,
    enabled: false,
  },
  {
    type: 'human_feedback' as const,
    label: 'Human Feedback',
    description: 'Collect human ratings on agent output.',
    icon: IconUsers,
    enabled: false,
  },
  {
    type: 'task_completion' as const,
    label: 'Task Completion',
    description: 'Verify that the requested task was completed.',
    icon: IconChecklist,
    enabled: false,
  },
  {
    type: 'custom' as const,
    label: 'Custom',
    description: 'Define your own evaluation logic.',
    icon: IconPuzzle,
    enabled: false,
  },
]

function emptyCriterion(): Criterion {
  return {
    id: crypto.randomUUID(),
    name: '',
    description: '',
    weight: 1,
    scale: {
      1: '',
      2: '',
      3: '',
      4: '',
      5: '',
    },
  }
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

// ============================================================================
// Main Builder
// ============================================================================

export function EvaluatorBuilderClient() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [selectedType, setSelectedType] = useState<string>('')

  // Rubric state
  const [rubricSource, setRubricSource] = useState<'template' | 'scratch' | ''>('')
  const [rubricName, setRubricName] = useState('')
  const [rubricDescription, setRubricDescription] = useState('')
  const [criteria, setCriteria] = useState<Criterion[]>([])

  // Config state
  const [evaluatorName, setEvaluatorName] = useState('')
  const [evaluatorDescription, setEvaluatorDescription] = useState('')
  const [judgeModel, setJudgeModel] = useState('')

  const [error, setError] = useState<string | null>(null)

  const templatesQuery = trpc.evals.listTemplates.useQuery(undefined, { enabled: step === 2 })
  const templates = templatesQuery.data ?? []

  const createRubricMutation = trpc.evals.createRubric.useMutation({
    onSuccess: (data) => {
      router.push(`/evals/evaluators/${data.evaluator.id}`)
    },
    onError: (err) => {
      setError(err.message)
    },
  })

  function applyTemplate(template: (typeof templates)[number]) {
    setRubricName(template.name)
    setRubricDescription(template.description)
    setCriteria(
      template.criteria.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        weight: c.weight,
        scale: c.scale as ScaleDescriptions,
      }))
    )
    setEvaluatorName(template.name)
    setEvaluatorDescription(template.description)
    setRubricSource('template')
  }

  function updateCriterion(index: number, updates: Partial<Criterion>) {
    setCriteria((prev) => prev.map((c, i) => (i === index ? { ...c, ...updates } : c)))
  }

  function removeCriterion(index: number) {
    setCriteria((prev) => prev.filter((_, i) => i !== index))
  }

  function updateScaleLevel(criterionIndex: number, level: 1 | 2 | 3 | 4 | 5, value: string) {
    setCriteria((prev) =>
      prev.map((c, i) =>
        i === criterionIndex ? { ...c, scale: { ...c.scale, [level]: value } } : c
      )
    )
  }

  function handleSave() {
    setError(null)

    const name = evaluatorName || rubricName
    if (!name) {
      setError('Please provide a name.')
      return
    }
    if (criteria.length === 0) {
      setError('Please add at least one criterion.')
      return
    }
    for (const c of criteria) {
      if (!c.name || !c.description) {
        setError(`Criterion "${c.name || '(unnamed)'}" needs a name and description.`)
        return
      }
      for (const level of [1, 2, 3, 4, 5] as const) {
        if (!c.scale[level]) {
          setError(`Criterion "${c.name}" is missing a description for level ${level}.`)
          return
        }
      }
    }

    createRubricMutation.mutate({
      name: rubricName || name,
      description: rubricDescription || evaluatorDescription || undefined,
      criteriaJson: criteria,
      judgeModel: judgeModel || undefined,
    })
  }

  const canProceedStep1 = selectedType === 'llm_judge'
  const canProceedStep2 = rubricSource !== '' && criteria.length > 0
  const canProceedStep3 = true
  const tw = totalWeight(criteria)

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {[1, 2, 3, 4].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-medium ${
                s === step
                  ? 'bg-primary text-primary-foreground'
                  : s < step
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-white/5 text-muted-foreground'
              }`}
            >
              {s}
            </div>
            {s < 4 && <div className="h-px w-8 bg-white/10" />}
          </div>
        ))}
        <span className="ml-2 text-xs text-muted-foreground">
          {step === 1 && 'Choose Type'}
          {step === 2 && 'Build Rubric'}
          {step === 3 && 'Configure'}
          {step === 4 && 'Review & Save'}
        </span>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Step 1: Choose evaluator type */}
      {step === 1 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {EVALUATOR_TYPES.map((et) => {
            const Icon = et.icon
            return (
              <button
                key={et.type}
                type="button"
                disabled={!et.enabled}
                onClick={() => setSelectedType(et.type)}
                className={`relative flex flex-col rounded-lg border p-4 text-left transition ${
                  selectedType === et.type
                    ? 'border-primary/60 bg-primary/10'
                    : et.enabled
                      ? 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]'
                      : 'cursor-not-allowed border-white/5 bg-white/[0.01] opacity-50'
                }`}
              >
                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-white/5">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="text-xs font-medium">{et.label}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">{et.description}</p>
                {!et.enabled && (
                  <Badge variant="outline" className="absolute right-3 top-3 text-[10px]">
                    Coming soon
                  </Badge>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Step 2: Build rubric */}
      {step === 2 && (
        <div className="space-y-6">
          {/* Source choice */}
          {rubricSource === '' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setRubricSource('template')}
                className="flex flex-col items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-6 transition hover:border-primary/40 hover:bg-white/[0.04]"
              >
                <IconTemplate className="h-6 w-6 text-muted-foreground" />
                <p className="text-sm font-medium">Start from Template</p>
                <p className="text-xs text-muted-foreground">
                  Choose from 4 built-in rubric templates.
                </p>
              </button>
              <button
                type="button"
                onClick={() => {
                  setRubricSource('scratch')
                  setCriteria([emptyCriterion()])
                }}
                className="flex flex-col items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-6 transition hover:border-primary/40 hover:bg-white/[0.04]"
              >
                <IconFileDescription className="h-6 w-6 text-muted-foreground" />
                <p className="text-sm font-medium">Start from Scratch</p>
                <p className="text-xs text-muted-foreground">
                  Build a custom rubric with your own criteria.
                </p>
              </button>
            </div>
          )}

          {/* Template selection */}
          {rubricSource === 'template' && criteria.length === 0 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Select a template to pre-fill your rubric:
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => applyTemplate(t)}
                    className="flex flex-col rounded-lg border border-white/10 bg-white/[0.02] p-4 text-left transition hover:border-primary/40 hover:bg-white/[0.04]"
                  >
                    <p className="text-sm font-medium">{t.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {t.criteria.map((c) => (
                        <Badge key={c.id} variant="secondary" className="text-[10px]">
                          {c.name}
                        </Badge>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setRubricSource('')}>
                <IconArrowLeft className="h-3 w-3" />
                Back
              </Button>
            </div>
          )}

          {/* Rubric builder form */}
          {rubricSource !== '' && criteria.length > 0 && (
            <div className="space-y-6">
              {/* Rubric name & description */}
              <Card className="border-white/10 bg-white/[0.02]">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Rubric Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label className="text-xs">Name</Label>
                    <Input
                      value={rubricName}
                      onChange={(e) => setRubricName(e.target.value)}
                      placeholder="e.g. General Assistant"
                      className="mt-1 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Description</Label>
                    <Textarea
                      value={rubricDescription}
                      onChange={(e) => setRubricDescription(e.target.value)}
                      placeholder="What does this rubric measure?"
                      className="mt-1 text-xs"
                      rows={2}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Criteria */}
              {criteria.map((criterion, index) => (
                <Card key={criterion.id} className="border-white/10 bg-white/[0.02]">
                  <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
                    <div className="flex-1">
                      <CardTitle className="text-sm">
                        Criterion {index + 1}
                        {criterion.name && `: ${criterion.name}`}
                      </CardTitle>
                      <CardDescription className="text-[10px]">
                        Weight: {criterion.weight} ({weightPercent(criterion.weight, tw)} of total)
                      </CardDescription>
                    </div>
                    {criteria.length > 1 && (
                      <Button variant="ghost" size="icon-xs" onClick={() => removeCriterion(index)}>
                        <IconTrash className="h-3 w-3 text-destructive" />
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label className="text-xs">Name</Label>
                        <Input
                          value={criterion.name}
                          onChange={(e) => updateCriterion(index, { name: e.target.value })}
                          placeholder="e.g. Accuracy"
                          className="mt-1 text-xs"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Weight</Label>
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
                          <span className="w-8 text-right text-xs font-medium">
                            {criterion.weight}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Description</Label>
                      <Textarea
                        value={criterion.description}
                        onChange={(e) => updateCriterion(index, { description: e.target.value })}
                        placeholder="What does this criterion measure?"
                        className="mt-1 text-xs"
                        rows={2}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Scale Descriptions (1-5)</Label>
                      <div className="mt-1 space-y-1.5">
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
                              placeholder={`Level ${level} description...`}
                              className="text-xs"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}

              <Button
                variant="outline"
                size="sm"
                onClick={() => setCriteria((prev) => [...prev, emptyCriterion()])}
              >
                <IconPlus className="h-3 w-3" />
                Add Criterion
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Step 3: Configure */}
      {step === 3 && (
        <Card className="border-white/10 bg-white/[0.02]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Evaluator Configuration</CardTitle>
            <CardDescription className="text-xs">
              Optionally override the evaluator name and judge model.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-xs">Evaluator Name</Label>
              <Input
                value={evaluatorName}
                onChange={(e) => setEvaluatorName(e.target.value)}
                placeholder={rubricName || 'Name for this evaluator'}
                className="mt-1 text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <Textarea
                value={evaluatorDescription}
                onChange={(e) => setEvaluatorDescription(e.target.value)}
                placeholder={rubricDescription || 'Optional description'}
                className="mt-1 text-xs"
                rows={2}
              />
            </div>
            <div>
              <Label className="text-xs">Judge Model Override (optional)</Label>
              <Input
                value={judgeModel}
                onChange={(e) => setJudgeModel(e.target.value)}
                placeholder="Leave blank to use default from settings"
                className="mt-1 text-xs"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                If blank, the global judge model from Eval Settings will be used.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Review & Save */}
      {step === 4 && (
        <div className="space-y-4">
          <Card className="border-white/10 bg-white/[0.02]">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Review</CardTitle>
              <CardDescription className="text-xs">
                Confirm the details before saving.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 text-xs">
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <span className="text-muted-foreground">Type</span>
                  <Badge variant="default" className="text-[10px]">
                    LLM Judge
                  </Badge>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <span className="text-muted-foreground">Rubric Name</span>
                  <span className="font-medium">{rubricName || evaluatorName || '--'}</span>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <span className="text-muted-foreground">Evaluator Name</span>
                  <span className="font-medium">{evaluatorName || rubricName || '--'}</span>
                </div>
                <div className="flex justify-between border-b border-white/5 pb-2">
                  <span className="text-muted-foreground">Criteria Count</span>
                  <span className="font-medium">{criteria.length}</span>
                </div>
                {judgeModel && (
                  <div className="flex justify-between border-b border-white/5 pb-2">
                    <span className="text-muted-foreground">Judge Model</span>
                    <span className="font-mono text-[10px]">{judgeModel}</span>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Criteria:</p>
                {criteria.map((c) => (
                  <div key={c.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">{c.name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        Weight: {c.weight} ({weightPercent(c.weight, tw)})
                      </span>
                    </div>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{c.description}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <div>
          {step > 1 && (
            <Button variant="ghost" size="sm" onClick={() => setStep(step - 1)}>
              <IconArrowLeft className="h-3 w-3" />
              Back
            </Button>
          )}
        </div>
        <div>
          {step < 4 && (
            <Button
              size="sm"
              disabled={
                (step === 1 && !canProceedStep1) ||
                (step === 2 && !canProceedStep2) ||
                (step === 3 && !canProceedStep3)
              }
              onClick={() => setStep(step + 1)}
            >
              Next
              <IconArrowRight className="h-3 w-3" />
            </Button>
          )}
          {step === 4 && (
            <Button size="sm" disabled={createRubricMutation.isPending} onClick={handleSave}>
              {createRubricMutation.isPending ? 'Saving...' : 'Save Evaluator'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
