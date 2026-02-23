'use client'

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconLoader2,
  IconPlayerPlay,
  IconRocket,
  IconUser,
  IconSparkles,
  IconCpu,
  IconPlug,
  IconWand,
  IconShield,
  IconMessageCircle,
  IconChecklist,
} from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { SOUL_PRESETS } from '@/lib/soul-presets'
import type { SoulPreset } from '@/lib/soul-presets'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  EmojiPicker,
  EmojiPickerContent,
  EmojiPickerFooter,
  EmojiPickerSearch,
} from '@/components/ui/emoji-picker'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'

// ============================================================================
// Types
// ============================================================================

interface WizardIdentity {
  name: string
  handle: string
  title: string
  emoji: string
  avatarUrl: string
  teamId: string
}

interface WizardModel {
  model: string
  temperature: number
  maxTokens: number
  editToolMode: 'hashline' | 'replace'
}

interface WizardCostLimit {
  period: string
  limitUsd: number
  softLimitPct: number
  hardLimitPct: number
}

interface WizardPluginAssignment {
  pluginInstanceId: string
  pluginType: string
  name: string
}

interface WizardSkillAttachment {
  skillSlug: string
  skillName: string
  priority: number
  autoInject: boolean
}

interface WizardNetworkPolicy {
  mode: 'allow-list' | 'deny-list' | 'unrestricted'
  presetId?: string
  customized?: boolean
  rules: Array<{ domain: string; action: 'allow' | 'deny' }>
}

interface WizardFeatures {
  allowEphemeralSandboxCreation: boolean
  allowRoutineManagement: boolean
  dangerouslyUnrestricted: boolean
}

interface WizardState {
  currentStep: number
  identity: WizardIdentity
  soul: string
  soulPresetId: string | null
  model: WizardModel
  costLimits: WizardCostLimit[]
  pluginAssignments: WizardPluginAssignment[]
  features: WizardFeatures
  skillAttachments: WizardSkillAttachment[]
  networkPolicy: WizardNetworkPolicy
  testAgentId: string | null
  testSessionKey: string | null
  completedSteps: Set<number>
}

type WizardAction =
  | { type: 'SET_STEP'; step: number }
  | { type: 'UPDATE_IDENTITY'; identity: Partial<WizardIdentity> }
  | { type: 'SET_SOUL'; soul: string; presetId?: string | null }
  | { type: 'UPDATE_MODEL'; model: Partial<WizardModel> }
  | { type: 'SET_COST_LIMITS'; costLimits: WizardCostLimit[] }
  | { type: 'SET_PLUGIN_ASSIGNMENTS'; assignments: WizardPluginAssignment[] }
  | { type: 'SET_FEATURES'; features: Partial<WizardFeatures> }
  | { type: 'SET_SKILL_ATTACHMENTS'; attachments: WizardSkillAttachment[] }
  | { type: 'SET_NETWORK_POLICY'; policy: WizardNetworkPolicy }
  | { type: 'SET_TEST_AGENT'; testAgentId: string; testSessionKey: string }
  | { type: 'MARK_STEP_COMPLETE'; step: number }

const DEFAULT_EMOJIS = ['🤖', '🔧', '📋', '🚀', '⚡', '🎯', '🔍', '💡', '🦾', '🧠', '⚙️', '🛠️']
const getRandomEmoji = () =>
  DEFAULT_EMOJIS[Math.floor(Math.random() * DEFAULT_EMOJIS.length)] ?? '🤖'

const DEFAULT_NETWORK_RULES: WizardNetworkPolicy = {
  mode: 'allow-list',
  presetId: 'development',
  rules: [
    { domain: 'github.com', action: 'allow' },
    { domain: '*.github.com', action: 'allow' },
    { domain: 'api.github.com', action: 'allow' },
    { domain: '*.githubusercontent.com', action: 'allow' },
    { domain: 'registry.npmjs.org', action: 'allow' },
    { domain: '*.npmjs.org', action: 'allow' },
    { domain: 'pypi.org', action: 'allow' },
    { domain: '*.pypi.org', action: 'allow' },
    { domain: 'files.pythonhosted.org', action: 'allow' },
    { domain: 'crates.io', action: 'allow' },
    { domain: '*.crates.io', action: 'allow' },
    { domain: '*', action: 'deny' },
  ],
}

function initialState(): WizardState {
  return {
    currentStep: 0,
    identity: {
      name: '',
      handle: '',
      title: '',
      emoji: getRandomEmoji(),
      avatarUrl: '',
      teamId: '',
    },
    soul: '',
    soulPresetId: null,
    model: {
      model: '',
      temperature: 0.7,
      maxTokens: 4096,
      editToolMode: 'hashline',
    },
    costLimits: [],
    pluginAssignments: [],
    features: {
      allowEphemeralSandboxCreation: true,
      allowRoutineManagement: false,
      dangerouslyUnrestricted: false,
    },
    skillAttachments: [],
    networkPolicy: DEFAULT_NETWORK_RULES,
    testAgentId: null,
    testSessionKey: null,
    completedSteps: new Set(),
  }
}

function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'SET_STEP':
      return { ...state, currentStep: action.step }
    case 'UPDATE_IDENTITY':
      return { ...state, identity: { ...state.identity, ...action.identity } }
    case 'SET_SOUL':
      return {
        ...state,
        soul: action.soul,
        soulPresetId: action.presetId !== undefined ? action.presetId : state.soulPresetId,
      }
    case 'UPDATE_MODEL':
      return { ...state, model: { ...state.model, ...action.model } }
    case 'SET_COST_LIMITS':
      return { ...state, costLimits: action.costLimits }
    case 'SET_PLUGIN_ASSIGNMENTS':
      return { ...state, pluginAssignments: action.assignments }
    case 'SET_FEATURES':
      return { ...state, features: { ...state.features, ...action.features } }
    case 'SET_SKILL_ATTACHMENTS':
      return { ...state, skillAttachments: action.attachments }
    case 'SET_NETWORK_POLICY':
      return { ...state, networkPolicy: action.policy }
    case 'SET_TEST_AGENT':
      return { ...state, testAgentId: action.testAgentId, testSessionKey: action.testSessionKey }
    case 'MARK_STEP_COMPLETE':
      return { ...state, completedSteps: new Set([...state.completedSteps, action.step]) }
    default:
      return state
  }
}

const STEPS = [
  { label: 'Identity', icon: IconUser },
  { label: 'Soul', icon: IconSparkles },
  { label: 'Model', icon: IconCpu },
  { label: 'Plugins', icon: IconPlug },
  { label: 'Skills', icon: IconWand },
  { label: 'Network', icon: IconShield },
  { label: 'Test', icon: IconMessageCircle },
  { label: 'Review', icon: IconChecklist },
]

// ============================================================================
// Main Wizard Component
// ============================================================================

export function AgentBuilderWizard() {
  const router = useRouter()
  const [state, dispatch] = useReducer(wizardReducer, undefined, initialState)
  const [saving, setSaving] = useState(false)
  const cleanupRef = useRef<string | null>(null)

  // Queries
  const teamsQuery = trpc.org.listTeams.useQuery()
  const teams = (teamsQuery.data ?? []) as { id: string; name: string }[]

  // Mutations
  const createAgentMutation = trpc.org.createAgent.useMutation()
  const createTestAgentMutation = trpc.agentBuilder.createTestAgent.useMutation()
  const cleanupTestAgentMutation = trpc.agentBuilder.cleanupTestAgent.useMutation()
  const promoteTestAgentMutation = trpc.agentBuilder.promoteTestAgent.useMutation()

  // Cleanup on unmount / navigate away
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (cleanupRef.current) {
        // Best-effort fire-and-forget
        navigator.sendBeacon?.(
          `/api/trpc/agentBuilder.cleanupTestAgent?batch=1&input=${encodeURIComponent(
            JSON.stringify({ 0: { json: { testAgentId: cleanupRef.current } } })
          )}`
        )
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      if (cleanupRef.current) {
        cleanupTestAgentMutation.mutate({ testAgentId: cleanupRef.current })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Track test agent ID for cleanup
  useEffect(() => {
    cleanupRef.current = state.testAgentId
  }, [state.testAgentId])

  const goToStep = useCallback(
    (step: number) => {
      // Mark current step as complete when advancing
      if (step > state.currentStep) {
        dispatch({ type: 'MARK_STEP_COMPLETE', step: state.currentStep })
      }
      dispatch({ type: 'SET_STEP', step })
    },
    [state.currentStep]
  )

  const goNext = useCallback(() => {
    if (state.currentStep < STEPS.length - 1) {
      goToStep(state.currentStep + 1)
    }
  }, [state.currentStep, goToStep])

  const goBack = useCallback(() => {
    if (state.currentStep > 0) {
      dispatch({ type: 'SET_STEP', step: state.currentStep - 1 })
    }
  }, [state.currentStep])

  const skipToReview = useCallback(() => {
    dispatch({ type: 'SET_STEP', step: STEPS.length - 1 })
  }, [])

  // ---- Save (create agent) ----
  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      if (state.testAgentId) {
        // Promote test agent path
        const result = await promoteTestAgentMutation.mutateAsync({
          testAgentId: state.testAgentId,
          finalIdentity: {
            name: state.identity.name,
            handle: state.identity.handle,
            title: state.identity.title || undefined,
            emoji: state.identity.emoji || undefined,
            avatarUrl: state.identity.avatarUrl || undefined,
          },
          finalConfig: {
            model: state.model.model || undefined,
            temperature: state.model.temperature,
            maxTokens: state.model.maxTokens,
            editToolMode: state.model.editToolMode,
            soul: state.soul || undefined,
            networkPolicy: state.networkPolicy,
            allowEphemeralSandboxCreation: state.features.allowEphemeralSandboxCreation,
            allowRoutineManagement: state.features.allowRoutineManagement,
            dangerouslyUnrestricted: state.features.dangerouslyUnrestricted,
          },
          teamId: state.identity.teamId || undefined,
          pluginAssignments: state.pluginAssignments.map((pa) => ({
            pluginInstanceId: pa.pluginInstanceId,
          })),
          skillAttachments: state.skillAttachments.map((sa) => ({
            skillSlug: sa.skillSlug,
            priority: sa.priority,
            autoInject: sa.autoInject,
          })),
          costLimits: state.costLimits,
        })

        // Clear cleanup ref so we don't delete the promoted agent
        cleanupRef.current = null
        toast.success('Agent created')
        router.push(`/agents/${result.agentId}`)
      } else {
        // Direct create path (no test conversation)
        const result = await createAgentMutation.mutateAsync({
          handle: state.identity.handle,
          name: state.identity.name,
          title: state.identity.title || null,
          emoji: state.identity.emoji || null,
          avatarUrl: state.identity.avatarUrl || null,
          teamId: state.identity.teamId || undefined,
        })

        // Now update the full config via the update route
        // We need to set soul, model, network policy, etc.
        // For simplicity we use the inline fetch approach used by SoulSection
        await fetch(`/api/agents/${result.id}/config`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: state.model.model || undefined,
            temperature: state.model.temperature,
            maxTokens: state.model.maxTokens,
            editToolMode: state.model.editToolMode,
            soul: state.soul || undefined,
            networkPolicy: state.networkPolicy,
            allowEphemeralSandboxCreation: state.features.allowEphemeralSandboxCreation,
            allowRoutineManagement: state.features.allowRoutineManagement,
            dangerouslyUnrestricted: state.features.dangerouslyUnrestricted,
          }),
        })

        toast.success('Agent created')
        router.push(`/agents/${result.id}`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create agent')
    } finally {
      setSaving(false)
    }
  }, [state, createAgentMutation, promoteTestAgentMutation, router])

  // ---- Render ----
  const canProceed =
    state.currentStep === 0 ? state.identity.name.trim() && state.identity.handle.trim() : true

  return (
    <div className="space-y-6">
      {/* Step indicator bar */}
      <div className="flex items-center gap-1 overflow-x-auto pb-2">
        {STEPS.map((step, idx) => {
          const Icon = step.icon
          const isActive = idx === state.currentStep
          const isCompleted = state.completedSteps.has(idx)
          const isAccessible = idx <= state.currentStep || isCompleted

          return (
            <button
              key={step.label}
              type="button"
              disabled={!isAccessible}
              onClick={() => isAccessible && dispatch({ type: 'SET_STEP', step: idx })}
              className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition whitespace-nowrap ${
                isActive
                  ? 'border border-primary/40 bg-primary/15 text-primary'
                  : isCompleted
                    ? 'border border-emerald-500/20 bg-emerald-500/5 text-emerald-300'
                    : isAccessible
                      ? 'border border-white/10 bg-white/[0.02] text-muted-foreground hover:bg-white/[0.04]'
                      : 'border border-white/5 bg-transparent text-white/20 cursor-not-allowed'
              }`}
            >
              {isCompleted && !isActive ? (
                <IconCheck className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Icon className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">
                {idx + 1}. {step.label}
              </span>
              <span className="sm:hidden">{idx + 1}</span>
            </button>
          )
        })}
      </div>

      {/* Step content */}
      <div className="min-h-[400px]">
        {state.currentStep === 0 && (
          <IdentityStep state={state} dispatch={dispatch} teams={teams} />
        )}
        {state.currentStep === 1 && <SoulStep state={state} dispatch={dispatch} />}
        {state.currentStep === 2 && <ModelBudgetStep state={state} dispatch={dispatch} />}
        {state.currentStep === 3 && <CapabilitiesStep state={state} dispatch={dispatch} />}
        {state.currentStep === 4 && <SkillsStep state={state} dispatch={dispatch} />}
        {state.currentStep === 5 && <NetworkPolicyStep state={state} dispatch={dispatch} />}
        {state.currentStep === 6 && (
          <TestConversationStep
            state={state}
            dispatch={dispatch}
            createTestAgentMutation={createTestAgentMutation}
          />
        )}
        {state.currentStep === 7 && <ReviewStep state={state} dispatch={dispatch} />}
      </div>

      {/* Navigation buttons */}
      <div className="flex items-center justify-between border-t border-white/10 pt-4">
        <div className="flex items-center gap-2">
          {state.currentStep > 0 && (
            <Button variant="outline" onClick={goBack}>
              <IconChevronLeft className="mr-1.5 h-3.5 w-3.5" />
              Back
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {state.currentStep < STEPS.length - 2 && (
            <Button
              variant="ghost"
              onClick={skipToReview}
              className="text-xs text-muted-foreground"
            >
              Skip to Review
            </Button>
          )}

          {state.currentStep < STEPS.length - 1 ? (
            <Button onClick={goNext} disabled={!canProceed}>
              Next
              <IconChevronRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              onClick={handleSave}
              disabled={saving || !state.identity.name.trim() || !state.identity.handle.trim()}
            >
              {saving ? (
                <>
                  <IconLoader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <IconRocket className="mr-1.5 h-3.5 w-3.5" />
                  Create Agent
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Step 1: Identity
// ============================================================================

function IdentityStep({
  state,
  dispatch,
  teams,
}: {
  state: WizardState
  dispatch: React.Dispatch<WizardAction>
  teams: { id: string; name: string }[]
}) {
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader>
        <CardTitle>Name and Purpose</CardTitle>
        <CardDescription>Who is this agent? Give it a name, handle, and role.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="builder-name">
            Name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="builder-name"
            value={state.identity.name}
            onChange={(e) =>
              dispatch({
                type: 'UPDATE_IDENTITY',
                identity: { name: (e.target as HTMLInputElement).value },
              })
            }
            placeholder="Mary"
          />
          <p className="text-xs text-muted-foreground">Display name shown in the UI.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="builder-handle">
            Agent ID <span className="text-destructive">*</span>
          </Label>
          <Input
            id="builder-handle"
            value={state.identity.handle}
            onChange={(e) =>
              dispatch({
                type: 'UPDATE_IDENTITY',
                identity: { handle: (e.target as HTMLInputElement).value },
              })
            }
            placeholder="mary"
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Used for @mentions. Letters, numbers, hyphens, underscores only.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="builder-title">Title</Label>
          <Input
            id="builder-title"
            value={state.identity.title}
            onChange={(e) =>
              dispatch({
                type: 'UPDATE_IDENTITY',
                identity: { title: (e.target as HTMLInputElement).value },
              })
            }
            placeholder="Sr Eng"
          />
          <p className="text-xs text-muted-foreground">Role or job description (optional).</p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Emoji</Label>
            <Popover open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
              <PopoverTrigger className="flex h-10 w-20 items-center justify-center rounded-md border border-input bg-background text-2xl hover:bg-accent hover:text-accent-foreground">
                {state.identity.emoji || '🤖'}
              </PopoverTrigger>
              <PopoverContent className="w-fit p-0" align="start">
                <EmojiPicker
                  className="h-[342px]"
                  onEmojiSelect={(emoji) => {
                    dispatch({ type: 'UPDATE_IDENTITY', identity: { emoji: emoji.emoji } })
                    setEmojiPickerOpen(false)
                  }}
                >
                  <EmojiPickerSearch placeholder="Search emoji..." />
                  <EmojiPickerContent />
                  <EmojiPickerFooter />
                </EmojiPicker>
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label htmlFor="builder-avatar">Avatar URL</Label>
            <Input
              id="builder-avatar"
              value={state.identity.avatarUrl}
              onChange={(e) =>
                dispatch({
                  type: 'UPDATE_IDENTITY',
                  identity: { avatarUrl: (e.target as HTMLInputElement).value },
                })
              }
              placeholder="https://example.com/avatar.png"
              type="url"
            />
          </div>
        </div>

        {teams.length > 0 && (
          <div className="space-y-2">
            <Label htmlFor="builder-team">Team Assignment</Label>
            <NativeSelect
              id="builder-team"
              value={state.identity.teamId}
              onChange={(e) =>
                dispatch({
                  type: 'UPDATE_IDENTITY',
                  identity: { teamId: (e.target as HTMLSelectElement).value },
                })
              }
              className="w-full max-w-sm"
            >
              <NativeSelectOption value="">No team (standalone agent)</NativeSelectOption>
              {teams.map((team) => (
                <NativeSelectOption key={team.id} value={team.id}>
                  {team.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ============================================================================
// Step 2: Soul / Personality
// ============================================================================

function SoulStep({
  state,
  dispatch,
}: {
  state: WizardState
  dispatch: React.Dispatch<WizardAction>
}) {
  const handleSelectPreset = (preset: SoulPreset) => {
    dispatch({ type: 'SET_SOUL', soul: preset.soul, presetId: preset.id })
  }

  return (
    <div className="space-y-4">
      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader>
          <CardTitle>Soul / Personality</CardTitle>
          <CardDescription>
            Choose a starting personality or write your own. This defines how the agent thinks and
            communicates.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Preset selector */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Start from a preset</Label>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {SOUL_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectPreset(preset)}
                  className={`rounded-lg border p-3 text-left transition ${
                    state.soulPresetId === preset.id
                      ? 'border-primary/50 bg-primary/10'
                      : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]'
                  }`}
                >
                  <p className="text-sm font-medium">{preset.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{preset.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Soul editor */}
          <div className="space-y-2">
            <Label htmlFor="builder-soul" className="text-xs text-muted-foreground">
              Soul document (markdown)
            </Label>
            <Textarea
              id="builder-soul"
              value={state.soul}
              onChange={(e) =>
                dispatch({ type: 'SET_SOUL', soul: (e.target as HTMLTextAreaElement).value })
              }
              placeholder="Write your agent's personality, working style, and preferences..."
              className="min-h-[300px] font-mono text-xs"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ============================================================================
// Step 3: Model & Budget
// ============================================================================

function ModelBudgetStep({
  state,
  dispatch,
}: {
  state: WizardState
  dispatch: React.Dispatch<WizardAction>
}) {
  const [showAddLimit, setShowAddLimit] = useState(false)
  const [newPeriod, setNewPeriod] = useState('daily')
  const [newLimitUsd, setNewLimitUsd] = useState('')

  const addCostLimit = () => {
    const limitUsd = parseFloat(newLimitUsd)
    if (isNaN(limitUsd) || limitUsd <= 0) return
    dispatch({
      type: 'SET_COST_LIMITS',
      costLimits: [
        ...state.costLimits,
        { period: newPeriod, limitUsd, softLimitPct: 80, hardLimitPct: 150 },
      ],
    })
    setNewLimitUsd('')
    setShowAddLimit(false)
  }

  const removeCostLimit = (idx: number) => {
    dispatch({
      type: 'SET_COST_LIMITS',
      costLimits: state.costLimits.filter((_, i) => i !== idx),
    })
  }

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader>
        <CardTitle>Model and Budget</CardTitle>
        <CardDescription>Choose the inference model and set cost limits.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="builder-model">Model</Label>
          <Input
            id="builder-model"
            value={state.model.model}
            onChange={(e) =>
              dispatch({
                type: 'UPDATE_MODEL',
                model: { model: (e.target as HTMLInputElement).value },
              })
            }
            placeholder="arcee-ai/trinity-large-preview:free"
            className="font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">
            Leave empty to use the default model. Enter the model&apos;s external ID.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="builder-temp">Temperature</Label>
            <Input
              id="builder-temp"
              type="number"
              min="0"
              max="2"
              step="0.1"
              value={state.model.temperature}
              onChange={(e) =>
                dispatch({
                  type: 'UPDATE_MODEL',
                  model: { temperature: parseFloat((e.target as HTMLInputElement).value) || 0.7 },
                })
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="builder-max-tokens">Max Tokens</Label>
            <Input
              id="builder-max-tokens"
              type="number"
              min="1"
              value={state.model.maxTokens}
              onChange={(e) =>
                dispatch({
                  type: 'UPDATE_MODEL',
                  model: { maxTokens: parseInt((e.target as HTMLInputElement).value) || 4096 },
                })
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="builder-edit-mode">Edit Tool Mode</Label>
            <NativeSelect
              id="builder-edit-mode"
              value={state.model.editToolMode}
              onChange={(e) =>
                dispatch({
                  type: 'UPDATE_MODEL',
                  model: {
                    editToolMode: (e.target as HTMLSelectElement).value as 'hashline' | 'replace',
                  },
                })
              }
            >
              <NativeSelectOption value="hashline">Hashline</NativeSelectOption>
              <NativeSelectOption value="replace">Replace</NativeSelectOption>
            </NativeSelect>
          </div>
        </div>

        {/* Cost limits */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Cost Limits</Label>
            {!showAddLimit && (
              <Button variant="outline" size="sm" onClick={() => setShowAddLimit(true)}>
                Add Limit
              </Button>
            )}
          </div>

          {state.costLimits.length > 0 && (
            <div className="space-y-2">
              {state.costLimits.map((cl, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 text-xs"
                >
                  <span>
                    ${cl.limitUsd.toFixed(2)} / {cl.period} (soft: {cl.softLimitPct}%, hard:{' '}
                    {cl.hardLimitPct}%)
                  </span>
                  <button
                    type="button"
                    onClick={() => removeCostLimit(idx)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {showAddLimit && (
            <div className="flex items-end gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Period</Label>
                <NativeSelect
                  value={newPeriod}
                  onChange={(e) => setNewPeriod((e.target as HTMLSelectElement).value)}
                >
                  <NativeSelectOption value="hourly">Hourly</NativeSelectOption>
                  <NativeSelectOption value="daily">Daily</NativeSelectOption>
                  <NativeSelectOption value="monthly">Monthly</NativeSelectOption>
                </NativeSelect>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Limit ($USD)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={newLimitUsd}
                  onChange={(e) => setNewLimitUsd((e.target as HTMLInputElement).value)}
                  placeholder="5.00"
                  className="w-24"
                />
              </div>
              <Button size="sm" onClick={addCostLimit}>
                Add
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAddLimit(false)}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================================================
// Step 4: Capabilities & Plugins
// ============================================================================

function CapabilitiesStep({
  state,
  dispatch,
}: {
  state: WizardState
  dispatch: React.Dispatch<WizardAction>
}) {
  const pluginInstancesQuery = trpc.pluginInstances.list.useQuery({})
  const instances = pluginInstancesQuery.data?.pluginInstances ?? []

  const toggleInstance = (instanceId: string, type: string, name: string) => {
    const existing = state.pluginAssignments.find((a) => a.pluginInstanceId === instanceId)
    if (existing) {
      dispatch({
        type: 'SET_PLUGIN_ASSIGNMENTS',
        assignments: state.pluginAssignments.filter((a) => a.pluginInstanceId !== instanceId),
      })
    } else {
      dispatch({
        type: 'SET_PLUGIN_ASSIGNMENTS',
        assignments: [
          ...state.pluginAssignments,
          { pluginInstanceId: instanceId, pluginType: type, name },
        ],
      })
    }
  }

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader>
        <CardTitle>Capabilities and Plugins</CardTitle>
        <CardDescription>
          Choose which plugin instances this agent should be connected to, and toggle feature flags.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Plugin instances */}
        <div className="space-y-2">
          <Label className="text-sm">Plugin Instances</Label>
          {instances.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No plugin instances available. You can assign them after creation.
            </p>
          ) : (
            <div className="space-y-2">
              {instances.map((inst) => {
                const isAssigned = state.pluginAssignments.some(
                  (a) => a.pluginInstanceId === inst.id
                )
                return (
                  <button
                    key={inst.id}
                    type="button"
                    onClick={() => toggleInstance(inst.id, inst.type, inst.name)}
                    className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition ${
                      isAssigned
                        ? 'border-primary/40 bg-primary/10'
                        : 'border-white/10 bg-white/[0.02] hover:border-white/20'
                    }`}
                  >
                    <div>
                      <span className="font-medium">{inst.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{inst.type}</span>
                    </div>
                    {isAssigned && <IconCheck className="h-4 w-4 text-primary" />}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Capabilities */}
        <div className="space-y-3">
          <Label className="text-sm">Capabilities</Label>
          <label className="flex items-center gap-3 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
            <input
              type="checkbox"
              checked={state.features.allowEphemeralSandboxCreation}
              onChange={(e) =>
                dispatch({
                  type: 'SET_FEATURES',
                  features: {
                    allowEphemeralSandboxCreation: (e.target as HTMLInputElement).checked,
                  },
                })
              }
              className="rounded border-white/20"
            />
            <div>
              <p className="text-sm">Ephemeral Workspace Creation</p>
              <p className="text-xs text-muted-foreground">
                Allow the agent to create temporary workspaces for task execution.
              </p>
            </div>
          </label>
          <label className="flex items-center gap-3 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
            <input
              type="checkbox"
              checked={state.features.allowRoutineManagement}
              onChange={(e) =>
                dispatch({
                  type: 'SET_FEATURES',
                  features: { allowRoutineManagement: (e.target as HTMLInputElement).checked },
                })
              }
              className="rounded border-white/20"
            />
            <div>
              <p className="text-sm">Routine Management</p>
              <p className="text-xs text-muted-foreground">
                Allow the agent to create and manage scheduled routines.
              </p>
            </div>
          </label>
        </div>

        {/* Fleet Access — visually separated */}
        <div className="space-y-3 border-t border-red-500/20 pt-4">
          <Label className="text-sm text-red-400">Fleet Access</Label>
          <label className="flex items-center gap-3 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2">
            <input
              type="checkbox"
              checked={state.features.dangerouslyUnrestricted}
              onChange={(e) => {
                const checked = (e.target as HTMLInputElement).checked
                if (checked) {
                  const confirmed = window.confirm(
                    'This grants the agent tools to create, modify, and delete any agent in the fleet. Are you sure?'
                  )
                  if (!confirmed) {
                    e.preventDefault()
                    return
                  }
                }
                dispatch({
                  type: 'SET_FEATURES',
                  features: { dangerouslyUnrestricted: checked },
                })
              }}
              className="rounded border-white/20"
            />
            <div>
              <p className="text-sm">Enable fleet-wide control</p>
              <p className="text-xs text-muted-foreground">
                Grants platform-control tools for managing agents across the fleet, including
                config, soul, and lifecycle.
              </p>
            </div>
          </label>
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================================================
// Step 5: Skills
// ============================================================================

function SkillsStep({
  state,
  dispatch,
}: {
  state: WizardState
  dispatch: React.Dispatch<WizardAction>
}) {
  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader>
        <CardTitle>Skills</CardTitle>
        <CardDescription>
          Attach skills from the skill catalog. Skills provide specialized capabilities.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.skillAttachments.length > 0 && (
          <div className="space-y-2">
            {state.skillAttachments.map((sa, idx) => (
              <div
                key={sa.skillSlug}
                className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.02] px-3 py-2"
              >
                <div>
                  <span className="text-sm font-medium">{sa.skillName || sa.skillSlug}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    Priority: {sa.priority} {sa.autoInject ? '(auto-inject)' : ''}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    dispatch({
                      type: 'SET_SKILL_ATTACHMENTS',
                      attachments: state.skillAttachments.filter((_, i) => i !== idx),
                    })
                  }
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Skills can also be attached from the agent detail page after creation. The skill catalog
          is available under the Skills section in the sidebar.
        </p>
      </CardContent>
    </Card>
  )
}

// ============================================================================
// Step 6: Network Policy
// ============================================================================

const POLICY_PRESETS: Array<{
  id: string
  name: string
  description: string
  policy: WizardNetworkPolicy
}> = [
  {
    id: 'unrestricted',
    name: 'Unrestricted',
    description: 'Full network access',
    policy: {
      mode: 'unrestricted',
      presetId: 'unrestricted',
      rules: [{ domain: '*', action: 'allow' }],
    },
  },
  {
    id: 'github-only',
    name: 'GitHub Only',
    description: 'GitHub API and git operations only',
    policy: {
      mode: 'allow-list',
      presetId: 'github-only',
      rules: [
        { domain: 'github.com', action: 'allow' },
        { domain: '*.github.com', action: 'allow' },
        { domain: 'api.github.com', action: 'allow' },
        { domain: 'raw.githubusercontent.com', action: 'allow' },
        { domain: '*.githubusercontent.com', action: 'allow' },
        { domain: '*', action: 'deny' },
      ],
    },
  },
  {
    id: 'development',
    name: 'Development',
    description: 'GitHub + npm + PyPI + common dev tooling',
    policy: DEFAULT_NETWORK_RULES,
  },
  {
    id: 'lockdown',
    name: 'Lockdown',
    description: 'Deny all external network access',
    policy: { mode: 'deny-list', presetId: 'lockdown', rules: [{ domain: '*', action: 'deny' }] },
  },
]

function NetworkPolicyStep({
  state,
  dispatch,
}: {
  state: WizardState
  dispatch: React.Dispatch<WizardAction>
}) {
  const selectedPresetId = state.networkPolicy.presetId

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader>
        <CardTitle>Network Policy</CardTitle>
        <CardDescription>
          Control which domains the agent can access from sandboxes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Preset selector */}
        <div className="grid gap-2 sm:grid-cols-2">
          {POLICY_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => dispatch({ type: 'SET_NETWORK_POLICY', policy: { ...preset.policy } })}
              className={`rounded-lg border p-3 text-left transition ${
                selectedPresetId === preset.id
                  ? 'border-primary/50 bg-primary/10'
                  : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]'
              }`}
            >
              <p className="text-sm font-medium">{preset.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{preset.description}</p>
            </button>
          ))}
        </div>

        {/* Rule list */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Active Rules</Label>
          <div className="rounded-md border border-white/10 bg-white/[0.02]">
            {state.networkPolicy.rules.map((rule, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between border-b border-white/5 px-3 py-1.5 last:border-0"
              >
                <code className="text-xs">{rule.domain}</code>
                <Badge
                  variant={rule.action === 'allow' ? 'default' : 'destructive'}
                  className="text-[10px]"
                >
                  {rule.action}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================================================
// Step 7: Test Conversation
// ============================================================================

function TestConversationStep({
  state,
  dispatch,
  createTestAgentMutation,
}: {
  state: WizardState
  dispatch: React.Dispatch<WizardAction>
  createTestAgentMutation: ReturnType<typeof trpc.agentBuilder.createTestAgent.useMutation>
}) {
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>(
    []
  )
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const utils = trpc.useUtils()
  const sendMutation = trpc.agentBuilder.sendTestMessage.useMutation()
  const updateConfigMutation = trpc.agentBuilder.updateTestAgentConfig.useMutation()

  const extractAssistantText = useCallback((content: string | null): string => {
    if (!content) return ''
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>
      if (typeof parsed.text === 'string' && parsed.text.trim().length > 0) {
        return parsed.text
      }
      if (typeof parsed.content === 'string' && parsed.content.trim().length > 0) {
        return parsed.content
      }
      if (Array.isArray(parsed.content)) {
        const textParts = parsed.content
          .map((part) => {
            if (typeof part === 'string') return part
            if (
              typeof part === 'object' &&
              part !== null &&
              'text' in part &&
              typeof (part as Record<string, unknown>).text === 'string'
            ) {
              return (part as Record<string, unknown>).text as string
            }
            return ''
          })
          .filter((part) => part.length > 0)
        if (textParts.length > 0) return textParts.join('\n')
      }
      return ''
    } catch {
      return content
    }
  }, [])

  const waitForRunCompletion = useCallback(
    async (jobId: string): Promise<string> => {
      const timeoutMs = 120_000
      const pollIntervalMs = 1_500
      const startedAt = Date.now()

      while (Date.now() - startedAt < timeoutMs) {
        const run = await utils.jobs.getJobWithMessages.fetch({ jobId })

        if (run.job.status === 'COMPLETED') {
          for (let i = run.messages.length - 1; i >= 0; i--) {
            const msg = run.messages[i]
            if (!msg || msg.role !== 'assistant') continue
            const text = extractAssistantText(msg.content)
            if (text.trim().length > 0) return text
          }
          if (run.job.final_response && run.job.final_response.trim().length > 0) {
            return run.job.final_response
          }
          return 'Run completed, but no assistant response was captured. Check the run trace for receipts.'
        }

        if (run.job.status === 'FAILED') {
          return `Run failed: ${run.job.error_text ?? 'No error details provided.'}`
        }

        if (run.job.status === 'CANCELLED') {
          return 'Run was cancelled before producing a response.'
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
      }

      return 'Run is still in progress. Open the run timeline to inspect progress and receipts.'
    },
    [extractAssistantText, utils.jobs.getJobWithMessages]
  )

  const createTestAgent = useCallback(async () => {
    if (state.testAgentId) {
      // Sync config instead of creating
      await updateConfigMutation.mutateAsync({
        testAgentId: state.testAgentId,
        config: {
          model: state.model.model || undefined,
          temperature: state.model.temperature,
          maxTokens: state.model.maxTokens,
          editToolMode: state.model.editToolMode,
          soul: state.soul || undefined,
          networkPolicy: state.networkPolicy as unknown as Record<string, unknown>,
          allowEphemeralSandboxCreation: state.features.allowEphemeralSandboxCreation,
          allowRoutineManagement: state.features.allowRoutineManagement,
          dangerouslyUnrestricted: state.features.dangerouslyUnrestricted,
        },
        identity: {
          name: state.identity.name,
          title: state.identity.title || undefined,
          emoji: state.identity.emoji || undefined,
          avatarUrl: state.identity.avatarUrl || undefined,
        },
      })
      return
    }

    const result = await createTestAgentMutation.mutateAsync({
      config: {
        model: state.model.model || undefined,
        temperature: state.model.temperature,
        maxTokens: state.model.maxTokens,
        editToolMode: state.model.editToolMode,
        soul: state.soul || undefined,
        networkPolicy: state.networkPolicy as unknown as Record<string, unknown>,
        allowEphemeralSandboxCreation: state.features.allowEphemeralSandboxCreation,
        allowRoutineManagement: state.features.allowRoutineManagement,
        dangerouslyUnrestricted: state.features.dangerouslyUnrestricted,
      },
      identity: {
        name: state.identity.name,
        title: state.identity.title || undefined,
        emoji: state.identity.emoji || undefined,
        avatarUrl: state.identity.avatarUrl || undefined,
      },
    })

    dispatch({
      type: 'SET_TEST_AGENT',
      testAgentId: result.testAgentId,
      testSessionKey: result.testSessionKey,
    })
  }, [state, createTestAgentMutation, updateConfigMutation, dispatch])

  // Auto-create test agent when entering this step
  useEffect(() => {
    void createTestAgent()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSend = useCallback(async () => {
    if (!input.trim() || !state.testAgentId || !state.testSessionKey) return
    const messageText = input.trim()
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: messageText }])
    setSending(true)

    try {
      const { jobId } = await sendMutation.mutateAsync({
        testAgentId: state.testAgentId,
        testSessionKey: state.testSessionKey,
        message: messageText,
      })

      const assistantReply = await waitForRunCompletion(jobId)

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: assistantReply,
        },
      ])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send message'
      toast.error(message)
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Test run failed: ${message}`,
        },
      ])
    } finally {
      setSending(false)
    }
  }, [input, sendMutation, state.testAgentId, state.testSessionKey, waitForRunCompletion])

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconPlayerPlay className="h-4 w-4" />
          Test Conversation
        </CardTitle>
        <CardDescription>
          Chat with a temporary instance of your agent to verify behavior. This step is optional.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {createTestAgentMutation.isPending ? (
          <div className="flex items-center justify-center py-8">
            <IconLoader2 className="mr-2 h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Creating test agent...</span>
          </div>
        ) : (
          <>
            {/* Chat messages */}
            <div className="max-h-[300px] min-h-[200px] space-y-3 overflow-y-auto rounded-md border border-white/10 bg-black/20 p-4">
              {messages.length === 0 && (
                <p className="text-center text-xs text-muted-foreground">
                  Send a message to test your agent.
                </p>
              )}
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                      msg.role === 'user'
                        ? 'bg-primary/20 text-primary-foreground'
                        : 'bg-white/5 text-foreground'
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
            </div>

            {/* Input */}
            <div className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput((e.target as HTMLInputElement).value)}
                placeholder="Type a test message..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void handleSend()
                  }
                }}
                disabled={sending || !state.testAgentId}
              />
              <Button
                onClick={() => void handleSend()}
                disabled={!input.trim() || sending || !state.testAgentId}
              >
                {sending ? <IconLoader2 className="h-4 w-4 animate-spin" /> : 'Send'}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ============================================================================
// Step 8: Review & Save
// ============================================================================

function ReviewStep({
  state,
  dispatch,
}: {
  state: WizardState
  dispatch: React.Dispatch<WizardAction>
}) {
  return (
    <div className="space-y-4">
      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader>
          <CardTitle>Review</CardTitle>
          <CardDescription>
            Review your agent configuration. Click any section to go back and edit.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Identity summary */}
          <ReviewSection
            title="Identity"
            step={0}
            onEdit={() => dispatch({ type: 'SET_STEP', step: 0 })}
          >
            <div className="grid gap-2 text-xs sm:grid-cols-2">
              <div>
                <span className="text-muted-foreground">Name: </span>
                <span className="font-medium">{state.identity.name || 'Not set'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Handle: </span>
                <span className="font-mono">
                  {state.identity.handle ? `@${state.identity.handle}` : 'Not set'}
                </span>
              </div>
              {state.identity.title && (
                <div>
                  <span className="text-muted-foreground">Title: </span>
                  <span>{state.identity.title}</span>
                </div>
              )}
              {state.identity.emoji && (
                <div>
                  <span className="text-muted-foreground">Emoji: </span>
                  <span>{state.identity.emoji}</span>
                </div>
              )}
            </div>
          </ReviewSection>

          {/* Soul summary */}
          <ReviewSection
            title="Soul / Personality"
            step={1}
            onEdit={() => dispatch({ type: 'SET_STEP', step: 1 })}
          >
            <p className="text-xs text-muted-foreground">
              {state.soul
                ? `${state.soul.slice(0, 120)}${state.soul.length > 120 ? '...' : ''}`
                : 'No soul document configured.'}
              {state.soulPresetId && (
                <span className="ml-2">
                  <Badge variant="outline" className="text-[10px]">
                    {SOUL_PRESETS.find((p) => p.id === state.soulPresetId)?.label ??
                      state.soulPresetId}
                  </Badge>
                </span>
              )}
            </p>
          </ReviewSection>

          {/* Model summary */}
          <ReviewSection
            title="Model and Budget"
            step={2}
            onEdit={() => dispatch({ type: 'SET_STEP', step: 2 })}
          >
            <div className="grid gap-2 text-xs sm:grid-cols-2">
              <div>
                <span className="text-muted-foreground">Model: </span>
                <span className="font-mono">{state.model.model || '(default)'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Temperature: </span>
                <span>{state.model.temperature}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Max Tokens: </span>
                <span>{state.model.maxTokens}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Cost Limits: </span>
                <span>
                  {state.costLimits.length > 0 ? `${state.costLimits.length} configured` : 'None'}
                </span>
              </div>
            </div>
          </ReviewSection>

          {/* Plugins summary */}
          <ReviewSection
            title="Plugins"
            step={3}
            onEdit={() => dispatch({ type: 'SET_STEP', step: 3 })}
          >
            <p className="text-xs text-muted-foreground">
              {state.pluginAssignments.length > 0
                ? state.pluginAssignments.map((pa) => pa.name).join(', ')
                : 'No plugin instances assigned.'}
            </p>
          </ReviewSection>

          {/* Skills summary */}
          <ReviewSection
            title="Skills"
            step={4}
            onEdit={() => dispatch({ type: 'SET_STEP', step: 4 })}
          >
            <p className="text-xs text-muted-foreground">
              {state.skillAttachments.length > 0
                ? state.skillAttachments.map((sa) => sa.skillSlug).join(', ')
                : 'No skills attached.'}
            </p>
          </ReviewSection>

          {/* Network policy summary */}
          <ReviewSection
            title="Network Policy"
            step={5}
            onEdit={() => dispatch({ type: 'SET_STEP', step: 5 })}
          >
            <p className="text-xs text-muted-foreground">
              {state.networkPolicy.presetId
                ? (POLICY_PRESETS.find((p) => p.id === state.networkPolicy.presetId)?.name ??
                  state.networkPolicy.presetId)
                : 'Custom'}{' '}
              - {state.networkPolicy.rules.length} rule(s)
            </p>
          </ReviewSection>

          {/* Feature flags */}
          <ReviewSection
            title="Features"
            step={3}
            onEdit={() => dispatch({ type: 'SET_STEP', step: 3 })}
          >
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant={state.features.allowEphemeralSandboxCreation ? 'default' : 'outline'}>
                Ephemeral Sandboxes: {state.features.allowEphemeralSandboxCreation ? 'On' : 'Off'}
              </Badge>
              <Badge variant={state.features.allowRoutineManagement ? 'default' : 'outline'}>
                Routines: {state.features.allowRoutineManagement ? 'On' : 'Off'}
              </Badge>
              <Badge variant={state.features.dangerouslyUnrestricted ? 'destructive' : 'outline'}>
                Dangerous Mode: {state.features.dangerouslyUnrestricted ? 'On' : 'Off'}
              </Badge>
            </div>
          </ReviewSection>
        </CardContent>
      </Card>
    </div>
  )
}

function ReviewSection({
  title,
  step: _step,
  onEdit,
  children,
}: {
  title: string
  step: number
  onEdit: () => void
  children: React.ReactNode
}) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.02] p-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-medium">{title}</h4>
        <button type="button" onClick={onEdit} className="text-xs text-primary hover:underline">
          Edit
        </button>
      </div>
      {children}
    </div>
  )
}
