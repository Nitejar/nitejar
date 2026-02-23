'use client'

import { IconCurrencyDollar } from '@tabler/icons-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { formatCost } from '@/lib/utils'

interface CostBadgeProps {
  totalCost: number
  externalCost: number
  externalCallCount?: number
  unpricedExternalCallCount?: number
  promptTokens: number
  completionTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** Cost attributed to passive memory extraction. */
  passiveMemoryCost?: number
  /** "pill" (default) renders with border/bg; "inline" renders as plain text */
  variant?: 'pill' | 'inline'
}

export function CostBadge({
  totalCost,
  externalCost,
  externalCallCount = 0,
  unpricedExternalCallCount = 0,
  promptTokens,
  completionTokens,
  cacheReadTokens,
  cacheWriteTokens,
  passiveMemoryCost = 0,
  variant = 'pill',
}: CostBadgeProps) {
  const isPill = variant === 'pill'
  const inferenceCost = totalCost - externalCost - passiveMemoryCost
  const totalTokens = promptTokens + completionTokens
  // Estimate input/output cost split proportionally by token count
  const promptCost = totalTokens > 0 ? inferenceCost * (promptTokens / totalTokens) : 0
  const completionCost = totalTokens > 0 ? inferenceCost * (completionTokens / totalTokens) : 0

  const badge = (
    <span
      className={
        isPill
          ? 'flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] font-medium text-muted-foreground'
          : 'flex items-center gap-1 tabular-nums'
      }
    >
      {isPill && <IconCurrencyDollar className="h-3 w-3" />}
      {promptTokens.toLocaleString()} in / {completionTokens.toLocaleString()} out
      {!isPill && <span> · </span>}
      {isPill && <span className="text-white/20">·</span>}
      {cacheReadTokens.toLocaleString()} cache read / {cacheWriteTokens.toLocaleString()} cache
      write
      {isPill && <span className="text-white/20">·</span>}
      {!isPill && <span> · </span>}
      {formatCost(totalCost)}
      {externalCallCount > 0 && (
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            unpricedExternalCallCount > 0 ? 'bg-amber-400' : 'bg-emerald-400'
          }`}
        />
      )}
    </span>
  )

  return (
    <Tooltip>
      <TooltipTrigger className="cursor-default">{badge}</TooltipTrigger>
      <TooltipContent side="bottom" align="end">
        <table className="text-xs tabular-nums">
          <tbody>
            <tr>
              <td className="pr-3 text-muted-foreground">Input</td>
              <td className="text-right">{formatCost(promptCost)}</td>
              <td className="pl-2 text-muted-foreground">{promptTokens.toLocaleString()} tokens</td>
            </tr>
            <tr>
              <td className="pr-3 text-muted-foreground">Output</td>
              <td className="text-right">{formatCost(completionCost)}</td>
              <td className="pl-2 text-muted-foreground">
                {completionTokens.toLocaleString()} tokens
              </td>
            </tr>
            <tr>
              <td className="pr-3 text-muted-foreground">Cache read</td>
              <td className="text-right">-</td>
              <td className="pl-2 text-muted-foreground">
                {cacheReadTokens.toLocaleString()} tokens
              </td>
            </tr>
            <tr>
              <td className="pr-3 text-muted-foreground">Cache write</td>
              <td className="text-right">-</td>
              <td className="pl-2 text-muted-foreground">
                {cacheWriteTokens.toLocaleString()} tokens
              </td>
            </tr>
            {passiveMemoryCost > 0 && (
              <tr>
                <td className="pr-3 text-muted-foreground">Memory extraction</td>
                <td className="text-right">{formatCost(passiveMemoryCost)}</td>
                <td />
              </tr>
            )}
            {externalCallCount > 0 && (
              <tr>
                <td className="pr-3 text-muted-foreground">External APIs</td>
                <td className="text-right">
                  {externalCost > 0
                    ? formatCost(externalCost)
                    : unpricedExternalCallCount > 0
                      ? 'Unpriced'
                      : formatCost(0)}
                </td>
                <td className="pl-2 text-muted-foreground">
                  {externalCallCount.toLocaleString()} call
                  {externalCallCount === 1 ? '' : 's'}
                  {unpricedExternalCallCount > 0
                    ? ` (${unpricedExternalCallCount.toLocaleString()} unknown)`
                    : ''}
                </td>
              </tr>
            )}
            <tr className="border-t border-white/10 font-semibold">
              <td className="pr-3 pt-0.5">Total</td>
              <td className="pt-0.5 text-right">{formatCost(totalCost)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </TooltipContent>
    </Tooltip>
  )
}
