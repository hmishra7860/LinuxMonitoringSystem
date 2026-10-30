export const cx = (...a) => a.filter(Boolean).join(' ')
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

export function hashStr(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export const pick = (r, arr) => arr[Math.floor(r() * arr.length)]
export const between = (r, a, b) => a + (b - a) * r()
export const int = (r, a, b) => Math.floor(between(r, a, b + 1))
export const uid = (p = '') => p + Math.random().toString(36).slice(2, 9)

let TZ = undefined
export function setTimezone(tz) { TZ = tz === 'Browser local' ? undefined : tz }
export function fmtDateTime(ts, opts) {
  if (!ts) return '—'
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, ...opts }).format(new Date(ts))
  } catch { return new Date(ts).toLocaleString() }
}
export const fmtFull = (ts) => fmtDateTime(ts, { year: 'numeric', second: '2-digit' })
export const fmtTime = (ts) => fmtDateTime(ts, { day: undefined, month: undefined })

export function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}
export const fmtUptime = (sec) => fmtDuration(sec * 1000)
export function timeAgo(ts, now = Date.now()) {
  if (!ts) return 'never'
  const d = now - ts
  if (d < 5000) return 'just now'
  return fmtDuration(d) + ' ago'
}
export const fmtPct = (v, d = 0) => `${Number(v).toFixed(d)}%`
export const fmtNum = (v, d = 1) => Number(v).toFixed(d)
export function fmtMbps(v) { return v >= 1000 ? `${(v / 1000).toFixed(2)} Gbps` : `${v.toFixed(1)} Mbps` }
export function fmtGb(v) { return v >= 1000 ? `${(v / 1024).toFixed(2)} TB` : `${v.toFixed(1)} GB` }

export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())
export const isHostOrIp = (v) => {
  const s = v.trim()
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(s)) return s.split('.').every((n) => +n <= 255)
  return /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(s)
}
export const isUrl = (v, https = false) => {
  try { const u = new URL(v); return https ? u.protocol === 'https:' : /^https?:$/.test(u.protocol) } catch { return false }
}
export function passwordIssues(p) {
  const out = []
  if (p.length < 8) out.push('at least 8 characters')
  if (!/[a-z]/.test(p)) out.push('a lowercase letter')
  if (!/[A-Z]/.test(p)) out.push('an uppercase letter')
  if (!/\d/.test(p)) out.push('a number')
  return out
}

export async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true } catch {
    try {
      const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok
    } catch { return false }
  }
}
export function downloadBlob(name, mime, content) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export const delay = (ms = 350) => new Promise((r) => setTimeout(r, ms))
export function randomToken(prefix, len = 32) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const arr = new Uint32Array(len)
  crypto.getRandomValues(arr)
  return prefix + Array.from(arr, (n) => chars[n % chars.length]).join('')
}
export function storageGet(kind, key) { try { return (kind === 'local' ? localStorage : sessionStorage).getItem(key) } catch { return null } }
export function storageSet(kind, key, val) { try { (kind === 'local' ? localStorage : sessionStorage).setItem(key, val) } catch { /* storage unavailable */ } }
export function storageDel(key) { try { localStorage.removeItem(key); sessionStorage.removeItem(key) } catch { /* noop */ } }
