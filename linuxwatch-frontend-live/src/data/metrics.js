// Time ranges + data hooks that read real metrics from the backend.
import { useEffect, useState } from 'react'
import { http } from '../api/http.js'
import { fmtDateTime } from '../lib/utils.js'

export const RANGES = [
  { id: '15m', label: 'Last 15 minutes', short: '15m', n: 15, step: 60e3 },
  { id: '1h', label: 'Last 1 hour', short: '1h', n: 30, step: 120e3 },
  { id: '6h', label: 'Last 6 hours', short: '6h', n: 36, step: 600e3 },
  { id: '24h', label: 'Last 24 hours', short: '24h', n: 48, step: 1800e3 },
  { id: '7d', label: 'Last 7 days', short: '7d', n: 56, step: 10800e3 },
  { id: 'custom', label: 'Custom range', short: 'Custom', n: 48, step: 0 },
]
export function rangeSpec(id, custom) {
  const r = RANGES.find((x) => x.id === id) || RANGES[3]
  if (id === 'custom' && custom?.from && custom?.to && custom.to > custom.from) return { ...r, step: (custom.to - custom.from) / (r.n - 1), end: custom.to }
  if (id === 'custom') return { ...RANGES[3], id: 'custom', end: Date.now() }
  return { ...r, end: Date.now() }
}
export function labelFor(ts, spec) {
  const span = spec.step * spec.n
  if (span > 36 * 3600e3) return fmtDateTime(ts, { hour: '2-digit', minute: '2-digit' })
  return fmtDateTime(ts, { day: undefined, month: undefined })
}

function windowFor(rangeId, custom) {
  const spec = rangeSpec(rangeId, custom)
  return { spec, to: Math.round(spec.end), from: Math.round(spec.end - (spec.n - 1) * spec.step) }
}
const toSeries = (res, spec) => ({ times: res.times, labels: res.times.map((t) => labelFor(t, spec)), values: res.values.map((v) => (v == null ? NaN : v)) })

/**
 * Fetch one or more time series. reqs = [{ id, path, params }]; returns { loading, error, data: { [id]: {labels, values, times} } }.
 * Refreshes every 30 s (except custom ranges).
 */
export function useSeriesSet(reqs, rangeId, custom, enabled = true) {
  const [state, setState] = useState({ loading: true, error: '', data: {} })
  const key = JSON.stringify(reqs) + '|' + rangeId + '|' + (rangeId === 'custom' ? custom.from + ':' + custom.to : '') + '|' + enabled
  useEffect(() => {
    if (!enabled || !reqs.length) { setState({ loading: false, error: '', data: {} }); return undefined }
    let cancelled = false
    const load = async (initial) => {
      if (initial) setState((s) => ({ ...s, loading: true }))
      try {
        const { spec, from, to } = windowFor(rangeId, custom)
        const res = await Promise.all(reqs.map((r) => http('GET', r.path + '?' + new URLSearchParams({ ...r.params, from, to, points: spec.n }))))
        if (cancelled) return
        const data = {}
        reqs.forEach((r, i) => { data[r.id] = toSeries(res[i], spec) })
        setState({ loading: false, error: '', data })
      } catch (e) { if (!cancelled) setState((s) => ({ ...s, loading: false, error: e.message })) }
    }
    load(true)
    const t = rangeId === 'custom' ? null : setInterval(() => load(false), 30000)
    return () => { cancelled = true; if (t) clearInterval(t) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state
}

/** Latest per-core CPU, load average, filesystems, interfaces and top processes for one server (refreshed every 15 s). */
export function useSnapshot(serverId) {
  const [snap, setSnap] = useState({ ts: null, perCore: [], loadAvg: [0, 0, 0], filesystems: [], interfaces: [], processes: [] })
  useEffect(() => {
    let cancelled = false
    const load = () => http('GET', `/servers/${serverId}/snapshot`).then((d) => { if (!cancelled) setSnap(d) }).catch(() => {})
    load()
    const t = setInterval(load, 15000)
    return () => { cancelled = true; clearInterval(t) }
  }, [serverId])
  return snap
}
