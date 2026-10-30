// HTTP layer for the LinuxWatch FastAPI backend. API address comes from public/config.js (window.LW_CONFIG.apiUrl).
import { storageDel, storageGet, storageSet } from '../lib/utils.js'

const cfg = (typeof window !== 'undefined' && window.LW_CONFIG) || {}
export const API_URL = String(cfg.apiUrl || 'http://localhost:8000/api/v1').replace(/\/+$/, '')
export const WS_URL = API_URL.replace(/^http/, 'ws') + '/ws'

let auth = { token: '', workspace: '' }
export const getAuth = () => auth
export function loadAuth() {
  auth = { token: storageGet('local', 'lw_token') || storageGet('session', 'lw_token') || '', workspace: storageGet('local', 'lw_ws') || storageGet('session', 'lw_ws') || '' }
  return auth
}
/** remember === undefined keeps whichever storage is already in use (used when only the workspace changes). */
export function setAuth(token, workspace, remember) {
  const kind = remember === undefined ? (storageGet('local', 'lw_token') ? 'local' : 'session') : remember ? 'local' : 'session'
  auth = { token, workspace }
  storageDel('lw_token'); storageDel('lw_ws')
  storageSet(kind, 'lw_token', token); storageSet(kind, 'lw_ws', workspace)
}
export function clearAuth() { auth = { token: '', workspace: '' }; storageDel('lw_token'); storageDel('lw_ws') }

export class ApiError extends Error { constructor(message, status) { super(message); this.status = status } }
let onUnauthorized = () => {}
export const setUnauthorizedHandler = (f) => { onUnauthorized = f }

function messageFrom(data, status) {
  const d = data && data.detail
  if (typeof d === 'string') return d
  if (Array.isArray(d)) return d.map((x) => { const f = Array.isArray(x.loc) ? x.loc.filter((l) => l !== 'body').join('.') : ''; return f ? `${f}: ${x.msg}` : x.msg }).join('; ')
  return status === 0 ? 'Cannot reach the LinuxWatch server. Check the API address in config.js.' : `Request failed (${status})`
}

export async function http(method, path, body, { auth: useAuth = true } = {}) {
  let res
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...(useAuth && auth.token && { Authorization: 'Bearer ' + auth.token }), ...(useAuth && auth.workspace && { 'X-Workspace-Id': auth.workspace }) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch { throw new ApiError(messageFrom(null, 0), 0) }
  if (res.status === 204) return null
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    if (res.status === 401 && useAuth && auth.token) onUnauthorized()
    throw new ApiError(messageFrom(data, res.status), res.status)
  }
  return data
}
