import { useEffect, useMemo, useRef, useState } from 'react'

const C = { grid: 'rgba(146,163,194,.14)', axis: '#5f7090', warn: '#f5b82e', crit: '#f0525a', text: '#92a3c2' }
export const COLORS = { blue: '#4c8dff', green: '#34d399', purple: '#8b7bff', teal: '#2dd4bf', amber: '#f5b82e', red: '#f0525a', pink: '#f472b6' }

function niceStep(max, ticks = 4) {
  const raw = max / ticks, mag = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / mag
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag
}
function useWidth() {
  const ref = useRef(null)
  const [w, setW] = useState(640)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setW(Math.max(260, el.clientWidth))
    const ro = new ResizeObserver((e) => setW(Math.max(260, e[0].contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

export function LineChart({ series, labels, thresholds, unit = '%', height = 220, yMax, area = true, decimals = 1, ariaLabel }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState(null)
  const pad = { l: unit === '%' ? 40 : 52, r: 14, t: 12, b: 26 }
  const iw = w - pad.l - pad.r, ih = height - pad.t - pad.b
  const n = labels.length
  const { max, ticks } = useMemo(() => {
    let m = yMax
    if (!m) {
      const vals = series.flatMap((s) => s.values.filter(Number.isFinite))
      m = unit === '%' ? 100 : Math.max(...vals, thresholds?.crit || 0, 1) * 1.1
    }
    const step = unit === '%' ? 25 : niceStep(m)
    const top = unit === '%' ? m : Math.ceil(m / step) * step
    return { max: top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) }
  }, [series, yMax, unit, thresholds])
  const x = (i) => pad.l + (n <= 1 ? 0 : (i * iw) / (n - 1))
  const y = (v) => pad.t + ih * (1 - Math.min(v, max) / max)
  const path = (vals) => { let d = '', pen = false; vals.forEach((v, i) => { if (!Number.isFinite(v)) { pen = false; return } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true }); return d }
  const areaPath = (vals) => { const idx = vals.map((v, i) => (Number.isFinite(v) ? i : -1)).filter((i) => i >= 0); if (!idx.length) return ''; return `${path(vals)}L${x(idx[idx.length - 1]).toFixed(1)},${y(0)}L${x(idx[0]).toFixed(1)},${y(0)}Z` }
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 80))))
  const fmt = (v) => (Number.isFinite(v) ? (unit === '%' ? v.toFixed(decimals) + '%' : v.toFixed(decimals) + ' ' + unit) : 'no data')
  const move = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = (e.clientX ?? e.touches?.[0]?.clientX) - r.left
    const i = Math.round(((px - pad.l) / iw) * (n - 1))
    setHover(Math.max(0, Math.min(n - 1, i)))
  }
  const gid = useMemo(() => 'g' + Math.random().toString(36).slice(2, 8), [])
  return (
    <div className="chart-wrap" ref={ref}>
      <svg width={w} height={height} role="img" aria-label={ariaLabel || 'Time series chart'} onPointerMove={move} onPointerLeave={() => setHover(null)} style={{ display: 'block', touchAction: 'pan-y' }}>
        <defs>{series.map((s, i) => <linearGradient key={i} id={`${gid}${i}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={s.color} stopOpacity=".28" /><stop offset="100%" stopColor={s.color} stopOpacity="0" /></linearGradient>)}</defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke={C.grid} />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill={C.axis}>{unit === '%' ? t + '%' : t}</text>
          </g>
        ))}
        {labels.map((l, i) => (i % every === 0 || i === n - 1) && (n - 1 - i) % every === 0 ? <text key={i} x={x(i)} y={height - 8} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize="11" fill={C.axis}>{l}</text> : null)}
        {thresholds?.warn != null && thresholds.warn <= max && <g><line x1={pad.l} x2={w - pad.r} y1={y(thresholds.warn)} y2={y(thresholds.warn)} stroke={C.warn} strokeDasharray="5 4" strokeWidth="1.3" /><text x={w - pad.r - 4} y={y(thresholds.warn) - 4} textAnchor="end" fontSize="10.5" fill={C.warn}>Warning {thresholds.warn}{unit === '%' ? '%' : ' ' + unit}</text></g>}
        {thresholds?.crit != null && thresholds.crit <= max && <g><line x1={pad.l} x2={w - pad.r} y1={y(thresholds.crit)} y2={y(thresholds.crit)} stroke={C.crit} strokeDasharray="5 4" strokeWidth="1.3" /><text x={w - pad.r - 4} y={y(thresholds.crit) - 4} textAnchor="end" fontSize="10.5" fill={C.crit}>Critical {thresholds.crit}{unit === '%' ? '%' : ' ' + unit}</text></g>}
        {area && series.map((s, i) => (i === 0 ? <path key={'a' + i} d={areaPath(s.values)} fill={`url(#${gid}${i})`} /> : null))}
        {series.map((s, i) => <path key={i} d={path(s.values)} fill="none" stroke={s.color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />)}
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="rgba(231,237,248,.35)" />
            {series.map((s, i) => Number.isFinite(s.values[hover]) && <circle key={i} cx={x(hover)} cy={y(s.values[hover])} r="4" fill={s.color} stroke="#0a1120" strokeWidth="2" />)}
          </g>
        )}
      </svg>
      {hover != null && (
        <div className="chart-tip" style={{ top: 6, left: x(hover) > w * 0.62 ? undefined : x(hover) + 12, right: x(hover) > w * 0.62 ? w - x(hover) + 12 : undefined }}>
          <div className="muted" style={{ marginBottom: 3 }}>{labels[hover]}</div>
          {series.map((s, i) => <div key={i}><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: s.color, marginRight: 6 }} />{s.name ? s.name + ': ' : ''}<b>{fmt(s.values[hover])}</b></div>)}
        </div>
      )}
    </div>
  )
}
export function Legend({ items }) {
  return <div className="legend">{items.map((i) => <span key={i.label}><i style={{ background: i.color }} />{i.label}</span>)}</div>
}

export function Donut({ data, size = 150, center, sub }) {
  const total = data.reduce((a, d) => a + d.value, 0)
  const r = size / 2 - 11, c = 2 * Math.PI * r
  let off = 0
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Distribution chart">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(146,163,194,.12)" strokeWidth="14" />
      {total > 0 && data.map((d) => {
        const len = (d.value / total) * c
        const el = <circle key={d.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={d.color} strokeWidth="14" strokeDasharray={`${Math.max(0, len - 2)} ${c - Math.max(0, len - 2)}`} strokeDashoffset={-off} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        off += len
        return el
      })}
      <text x="50%" y={sub ? '47%' : '52%'} textAnchor="middle" fontSize="24" fontWeight="650" fill="#e7edf8">{center ?? total}</text>
      {sub && <text x="50%" y="62%" textAnchor="middle" fontSize="11" fill={C.text}>{sub}</text>}
    </svg>
  )
}
export function Sparkline({ values, color = COLORS.blue, width = 90, height = 26 }) {
  const v = values.filter(Number.isFinite)
  if (v.length < 2) return null
  const min = Math.min(...v), max = Math.max(...v), rng = max - min || 1
  const pts = v.map((val, i) => `${(i / (v.length - 1)) * width},${height - 2 - ((val - min) / rng) * (height - 4)}`).join(' ')
  return <svg width={width} height={height}><polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" /></svg>
}
