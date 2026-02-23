'use client'

import { useEffect, useState } from 'react'
import { IconSettings, IconCheck, IconAlertTriangle } from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

export function EvalSettingsClient() {
  const [judgeModel, setJudgeModel] = useState('')
  const [sampleRateDefault, setSampleRateDefault] = useState('1')
  const [highVolumeThreshold, setHighVolumeThreshold] = useState('20')
  const [highVolumeSampleRate, setHighVolumeSampleRate] = useState('0.2')
  const [maxDailyEvals, setMaxDailyEvals] = useState('50')
  const [costBudget, setCostBudget] = useState('')
  const [status, setStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const settingsQuery = trpc.evals.getSettings.useQuery()
  const updateMutation = trpc.evals.updateSettings.useMutation({
    onSuccess: () => {
      setStatus({ type: 'success', text: 'Eval settings saved.' })
    },
    onError: (err) => {
      setStatus({ type: 'error', text: err.message })
    },
  })

  useEffect(() => {
    if (!settingsQuery.data) return
    const s = settingsQuery.data
    setJudgeModel(s.judge_model ?? '')
    setSampleRateDefault(String(s.sample_rate_default))
    setHighVolumeThreshold(String(s.sample_rate_high_volume_threshold))
    setHighVolumeSampleRate(String(s.sample_rate_high_volume))
    setMaxDailyEvals(String(s.max_daily_evals))
    setCostBudget(s.eval_cost_budget_usd != null ? String(s.eval_cost_budget_usd) : '')
  }, [settingsQuery.data])

  function handleSave() {
    setStatus(null)
    updateMutation.mutate({
      judgeModel: judgeModel || null,
      sampleRateDefault: parseFloat(sampleRateDefault) || 1,
      sampleRateHighVolumeThreshold: parseInt(highVolumeThreshold) || 20,
      sampleRateHighVolume: parseFloat(highVolumeSampleRate) || 0.2,
      maxDailyEvals: parseInt(maxDailyEvals) || 50,
      evalCostBudgetUsd: costBudget ? parseFloat(costBudget) : null,
    })
  }

  return (
    <div className="space-y-6">
      {status && (
        <div
          className={`flex items-center gap-2 rounded-lg border p-3 text-xs ${
            status.type === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
              : 'border-destructive/30 bg-destructive/10 text-destructive'
          }`}
        >
          {status.type === 'success' ? (
            <IconCheck className="h-3.5 w-3.5" />
          ) : (
            <IconAlertTriangle className="h-3.5 w-3.5" />
          )}
          {status.text}
        </div>
      )}

      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <IconSettings className="h-4 w-4 text-muted-foreground" />
            Evaluation Pipeline
          </CardTitle>
          <CardDescription className="text-xs">
            Global defaults for the eval pipeline. Individual evaluators can override the judge
            model.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Judge model */}
          <div>
            <Label className="text-xs">Judge Model</Label>
            <Input
              value={judgeModel}
              onChange={(e) => setJudgeModel(e.target.value)}
              placeholder="e.g. openai/gpt-4o or anthropic/claude-3.5-sonnet"
              className="mt-1 text-xs"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              The LLM used as judge when no evaluator-level override is set.
            </p>
          </div>

          {/* Sample rate */}
          <div>
            <Label className="text-xs">Default Sample Rate</Label>
            <Input
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={sampleRateDefault}
              onChange={(e) => setSampleRateDefault(e.target.value)}
              className="mt-1 w-32 text-xs"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Fraction of completed runs to evaluate (0 = none, 1 = all).
            </p>
          </div>

          {/* High volume threshold */}
          <div>
            <Label className="text-xs">High Volume Threshold</Label>
            <Input
              type="number"
              min="0"
              step="1"
              value={highVolumeThreshold}
              onChange={(e) => setHighVolumeThreshold(e.target.value)}
              className="mt-1 w-32 text-xs"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Number of completed runs/day before switching to the high-volume sample rate.
            </p>
          </div>

          {/* High volume sample rate */}
          <div>
            <Label className="text-xs">High Volume Sample Rate</Label>
            <Input
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={highVolumeSampleRate}
              onChange={(e) => setHighVolumeSampleRate(e.target.value)}
              className="mt-1 w-32 text-xs"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Sample rate used when daily run count exceeds the threshold above.
            </p>
          </div>

          {/* Max daily evals */}
          <div>
            <Label className="text-xs">Max Daily Evals</Label>
            <Input
              type="number"
              min="0"
              step="1"
              value={maxDailyEvals}
              onChange={(e) => setMaxDailyEvals(e.target.value)}
              className="mt-1 w-32 text-xs"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Hard cap on eval runs per agent per day.
            </p>
          </div>

          {/* Cost budget */}
          <div>
            <Label className="text-xs">Cost Budget (USD)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={costBudget}
              onChange={(e) => setCostBudget(e.target.value)}
              placeholder="No limit"
              className="mt-1 w-32 text-xs"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Daily cost cap for evals. Leave blank for no limit.
            </p>
          </div>

          <div className="pt-2">
            <Button size="sm" disabled={updateMutation.isPending} onClick={handleSave}>
              {updateMutation.isPending ? 'Saving...' : 'Save Settings'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
