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
  rollup?: {
    totalCost: number
    externalCost: number
    externalCallCount: number
    unpricedExternalCallCount: number
    promptTokens: number
    completionTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    passiveMemoryCost: number
    childRunCost: number
    childRunCount: number
  }
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
  rollup,
  variant = 'pill',
}: CostBadgeProps) {
  const isPill = variant === 'pill'
  const displayedTotalCost = rollup?.totalCost ?? totalCost
  const displayedExternalCost = rollup?.externalCost ?? externalCost
  const displayedExternalCallCount = rollup?.externalCallCount ?? externalCallCount
  const displayedUnpricedExternalCallCount =
    rollup?.unpricedExternalCallCount ?? unpricedExternalCallCount
  const displayedPromptTokens = rollup?.promptTokens ?? promptTokens
  const displayedCompletionTokens = rollup?.completionTokens ?? completionTokens
  const displayedCacheReadTokens = rollup?.cacheReadTokens ?? cacheReadTokens
  const displayedCacheWriteTokens = rollup?.cacheWriteTokens ?? cacheWriteTokens
  const displayedPassiveMemoryCost = rollup?.passiveMemoryCost ?? passiveMemoryCost
  const inferenceCost = displayedTotalCost - displayedExternalCost - displayedPassiveMemoryCost
  const totalTokens = displayedPromptTokens + displayedCompletionTokens
  // Estimate input/output cost split proportionally by token count
  const promptCost = totalTokens > 0 ? inferenceCost * (displayedPromptTokens / totalTokens) : 0
  const completionCost =
    totalTokens > 0 ? inferenceCost * (displayedCompletionTokens / totalTokens) : 0
  const childRunCost = rollup?.childRunCost ?? 0
  const childRunCount = rollup?.childRunCount ?? 0
  const hasChildRunRollup = childRunCost > 0 && childRunCount > 0

  const badge = (
    <span
      className={
        isPill
          ? 'flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] font-medium text-muted-foreground'
          : 'flex items-center gap-1 tabular-nums'
      }
    >
      {isPill && <IconCurrencyDollar className="h-3 w-3" />}
      {displayedPromptTokens.toLocaleString()} in / {displayedCompletionTokens.toLocaleString()} out
      {!isPill && <span> · </span>}
      {isPill && <span className="text-white/20">·</span>}
      {displayedCacheReadTokens.toLocaleString()} cache read /{' '}
      {displayedCacheWriteTokens.toLocaleString()} cache write
      {isPill && <span className="text-white/20">·</span>}
      {!isPill && <span> · </span>}
      {formatCost(displayedTotalCost)}
      {displayedExternalCallCount > 0 && (
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            displayedUnpricedExternalCallCount > 0 ? 'bg-amber-400' : 'bg-emerald-400'
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
              <td className="pl-2 text-muted-foreground">
                {displayedPromptTokens.toLocaleString()} tokens
              </td>
            </tr>
            <tr>
              <td className="pr-3 text-muted-foreground">Output</td>
              <td className="text-right">{formatCost(completionCost)}</td>
              <td className="pl-2 text-muted-foreground">
                {displayedCompletionTokens.toLocaleString()} tokens
              </td>
            </tr>
            <tr>
              <td className="pr-3 text-muted-foreground">Cache read</td>
              <td className="text-right">-</td>
              <td className="pl-2 text-muted-foreground">
                {displayedCacheReadTokens.toLocaleString()} tokens
              </td>
            </tr>
            <tr>
              <td className="pr-3 text-muted-foreground">Cache write</td>
              <td className="text-right">-</td>
              <td className="pl-2 text-muted-foreground">
                {displayedCacheWriteTokens.toLocaleString()} tokens
              </td>
            </tr>
            {displayedPassiveMemoryCost > 0 && (
              <tr>
                <td className="pr-3 text-muted-foreground">Memory extraction</td>
                <td className="text-right">{formatCost(displayedPassiveMemoryCost)}</td>
                <td />
              </tr>
            )}
            {displayedExternalCallCount > 0 && (
              <tr>
                <td className="pr-3 text-muted-foreground">External APIs</td>
                <td className="text-right">
                  {displayedExternalCost > 0
                    ? formatCost(displayedExternalCost)
                    : displayedUnpricedExternalCallCount > 0
                      ? 'Unpriced'
                      : formatCost(0)}
                </td>
                <td className="pl-2 text-muted-foreground">
                  {displayedExternalCallCount.toLocaleString()} call
                  {displayedExternalCallCount === 1 ? '' : 's'}
                  {displayedUnpricedExternalCallCount > 0
                    ? ` (${displayedUnpricedExternalCallCount.toLocaleString()} unknown)`
                    : ''}
                </td>
              </tr>
            )}
            <tr className="border-t border-white/10 font-semibold">
              <td className="pr-3 pt-0.5">Total</td>
              <td className="pt-0.5 text-right">{formatCost(displayedTotalCost)}</td>
              <td />
            </tr>
          </tbody>
        </table>
        {hasChildRunRollup ? (
          <div className="mt-2 border-t border-white/10 pt-2 text-[11px] text-muted-foreground">
            Includes {childRunCount.toLocaleString()} child run{childRunCount === 1 ? '' : 's'}: +
            {formatCost(childRunCost)}
          </div>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}
