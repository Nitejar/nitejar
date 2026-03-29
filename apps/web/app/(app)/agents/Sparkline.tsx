export function Sparkline({
  data,
  width = 120,
  height = 32,
}: {
  data: number[]
  width?: number
  height?: number
}) {
  if (data.length < 2) {
    return (
      <svg width={width} height={height} className="text-muted-foreground/30">
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
      </svg>
    )
  }
  const max = Math.max(...data, 1)
  const points = data
    .map((v, i) => `${(i / (data.length - 1)) * width},${height - (v / max) * (height - 4) - 2}`)
    .join(' ')
  return (
    <svg width={width} height={height} className="text-primary">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
