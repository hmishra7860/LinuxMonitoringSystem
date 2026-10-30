/**
 * LinuxWatch API client – talks to the FastAPI backend (see backend README).
 * Pattern: call the REST endpoint, then re-hydrate the store from GET /bootstrap. WebSocket pushes keep it live.
 */
import { getState, setState, initState } from './store.js'
import { http, setAuth, clearAuth, loadAuth, getAuth, setUnauthorizedHandler, API_URL, WS_URL } from './http.js'
import { setTimezone, uid, storageGet, storageSet } from '../lib/utils.js'
import { navigate } from '../lib/router.jsx'

export { API_URL }
export const DATA_MODE = 'live'

const EMPTY = {
  users: [], session: null, booting: false, workspaces: [], workspaceId: '', role: 'Viewer', servers: [], policies: [], alerts: [], suppressions: [], suppressionAudit: [],
  integrations: [], rules: [], deliveries: [], events: [], members: [], tokens: [], audit: [], wsConnected: false,
  settings: { timezone: 'UTC', heartbeatSec: 30, collectionSec: 30, logLevel: 'WARNING', logSources: [], retentionDays: 30, notif: {} },
}

export function toast(type, message) {
  const id = uid('t')
  setState((s) => ({ toasts: [...s.toasts, { id, type, message }] }))
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4500)
}

async function hydrate() {
  const d = await http('GET', '/bootstrap')
  setState((s) => ({ ...d, now: Date.now(), users: s.users.map((u) => ({ ...u, role: d.role })) }))
  setTimezone(d.settings.timezone)
}
let hydrateTimer
export function scheduleHydrate() { clearTimeout(hydrateTimer); hydrateTimer = setTimeout(() => hydrate().catch(() => {}), 500) }
const mutate = async (fn) => { const r = await fn(); await hydrate(); return r }
const pickKeys = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function bootstrap() {
  initState({ ...EMPTY, toasts: [], now: Date.now(), lastRead: Number(storageGet('local', 'lw_lastread')) || Date.now() })
  setUnauthorizedHandler(() => { clearAuth(); setState({ ...EMPTY, toasts: getState().toasts }); navigate('/login', { replace: true }) })
  if (!loadAuth().token) return
  setState({ booting: true })
  try {
    const me = await http('GET', '/auth/me')
    await hydrate()
    setState({ users: [{ ...me.user, role: me.role }], workspaces: me.workspaces, workspaceId: me.workspaceId, session: { userId: me.user.id } })
  } catch { clearAuth() }
  setState({ booting: false })
}

// ---------- real-time: WebSocket feed + clock ----------
let rt = null
export function startRealtime() {
  let ws, closed = false, retry = 0, ping
  const handle = (m) => {
    if (m.type === 'server.update') {
      const { type, serverId, ...fields } = m // eslint-disable-line no-unused-vars
      if (!getState().servers.some((x) => x.id === serverId)) return scheduleHydrate()
      setState((s) => ({ servers: s.servers.map((x) => (x.id === serverId ? { ...x, ...fields } : x)) }))
    } else if (m.type === 'alerts.changed' || m.type === 'deliveries.changed' || m.type === 'event') scheduleHydrate()
  }
  const connect = () => {
    const a = getAuth()
    ws = new WebSocket(WS_URL)
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: a.token, workspace: a.workspace }))
    ws.onmessage = (e) => {
      let m
      try { m = JSON.parse(e.data) } catch { return }
      if (m.type === 'ready') { retry = 0; setState({ wsConnected: true }); ping = setInterval(() => ws.readyState === 1 && ws.send('ping'), 25000) } else handle(m)
    }
    ws.onclose = () => { clearInterval(ping); setState({ wsConnected: false }); if (!closed) setTimeout(connect, Math.min(30000, 1000 * 2 ** retry++)) }
  }
  connect()
  const clock = setInterval(() => setState({ now: Date.now() }), 5000)
  const safety = setInterval(() => hydrate().catch(() => {}), 60000) // catches expiries/auto-resolves even if a push is missed
  rt = { reconnect: () => { try { ws.close() } catch { /* already closed */ } } }
  return () => { closed = true; clearInterval(clock); clearInterval(safety); clearInterval(ping); try { ws.close() } catch { /* noop */ } rt = null }
}

// ---------- API ----------
export const api = {
  mode: DATA_MODE,

  // auth
  async login(email, password, remember) {
    clearAuth()
    const r = await http('POST', '/auth/login', { email: email.trim(), password, remember: !!remember }, { auth: false })
    const ws = r.workspaces[0]
    if (!ws) throw new Error('This account has no workspace.')
    setAuth(r.token, ws.id, !!remember)
    try { await hydrate() } catch (e) { clearAuth(); throw e }
    setState({ users: [{ ...r.user, role: ws.role }], workspaces: r.workspaces, workspaceId: ws.id, session: { userId: r.user.id } })
    return r.user
  },
  async register({ name, company, email, password }) { return http('POST', '/auth/register', { name: name.trim(), company: company.trim(), email: email.trim(), password }, { auth: false }) },
  async forgotPassword(email) { return http('POST', '/auth/forgot', { email: email.trim() }, { auth: false }) },
  logout() { clearAuth(); setState({ ...EMPTY, toasts: getState().toasts }) },
  async updateProfile({ name, email }) {
    const u = await http('PATCH', '/auth/profile', { name: name.trim(), email: email.trim() })
    setState((s) => ({ users: s.users.map((x) => ({ ...x, ...u })) }))
  },
  async changePassword(current, next) { await http('POST', '/auth/password', { current, new: next }) },

  // servers
  async createServer(d) {
    return mutate(() => http('POST', '/servers', { name: d.name.trim(), hostname: d.hostname.trim(), os: d.os, osVersion: d.osVersion || '—', env: d.env, client: d.client, region: d.region, tags: d.tags, description: d.description, monitoring: d.monitoring }))
  },
  async updateServer(id, patch) {
    if (patch.services) await http('PUT', `/servers/${id}/services`, { services: patch.services.map((s) => ({ name: s.name, unit: s.unit, monitored: s.monitored })) })
    const fields = pickKeys(patch, ['name', 'hostname', 'os', 'osVersion', 'description', 'env', 'client', 'region', 'tags', 'monitoring'])
    if (Object.keys(fields).length) await http('PATCH', `/servers/${id}`, fields)
    await hydrate()
  },
  async deleteServer(id) { await mutate(() => http('DELETE', `/servers/${id}`)) },
  async regenerateToken(id) { const r = await http('POST', `/servers/${id}/token/regenerate`); await hydrate(); return r.token },

  // policies
  async savePolicy(p) {
    const body = pickKeys(p, ['name', 'description', 'isDefault', 'enabled', 'assignments', 'cpu', 'memory', 'disk', 'network', 'service'])
    const r = await (p.id ? http('PUT', `/policies/${p.id}`, body) : http('POST', '/policies', body))
    await hydrate()
    return r
  },
  async deletePolicy(id) { await mutate(() => http('DELETE', `/policies/${id}`)) },

  // alerts
  async ackAlert(id) { await mutate(() => http('POST', `/alerts/${id}/ack`)) },
  async resolveAlert(id) { await mutate(() => http('POST', `/alerts/${id}/resolve`)) },
  async bulkAlerts(ids, action) { await mutate(() => http('POST', '/alerts/bulk', { ids, action })) },
  async suppressAlert(alert, durationId, reason) { return api.createSuppression({ target: 'server:' + alert.serverId, modules: [alert.module], durationId, reason }) },
  async unsuppressAlert(alert) { const r = await mutate(() => http('POST', `/alerts/${alert.id}/unsuppress`)); return r.ended },
  async simulateAlert(serverId) {
    const r = await http('POST', '/alerts/simulate', { serverId })
    if (!r.suppressed) await sleep(1800) // notifications are delivered asynchronously by the backend
    await hydrate()
    return { ...r, deliveries: getState().deliveries.filter((d) => d.alertId === r.alert.id) }
  },

  // suppression
  async createSuppression({ target, modules, durationId, reason }) { return mutate(() => http('POST', '/suppressions', { target, modules, durationId, reason: reason || '' })) },
  async endSuppression(id) { await mutate(() => http('POST', `/suppressions/${id}/end`)) },

  // integrations + routing
  async saveIntegration(draft, secrets = {}) {
    const body = { type: draft.type, name: draft.name, enabled: draft.enabled ?? true, config: draft.config, secrets: Object.fromEntries(Object.entries(secrets).filter(([, v]) => v)) }
    return mutate(() => (draft.id ? http('PUT', `/integrations/${draft.id}`, body) : http('POST', '/integrations', body)))
  },
  async toggleIntegration(id) {
    const i = getState().integrations.find((x) => x.id === id)
    await mutate(() => http('PUT', `/integrations/${id}`, { type: i.type, name: i.name, enabled: !i.enabled, config: i.config, secrets: {} }))
  },
  async deleteIntegration(id) { await mutate(() => http('DELETE', `/integrations/${id}`)) },
  /** target = saved integration id (string) or an unsaved draft object. Returns { ok, message }. */
  async testIntegration(target, secrets = {}) {
    try {
      if (typeof target === 'string') { const r = await http('POST', `/integrations/${target}/test`); await hydrate(); return r }
      return await http('POST', '/integrations/test', { type: target.type, name: target.name || 'test', enabled: true, config: target.config, secrets })
    } catch (e) { return { ok: false, message: e.message } }
  },
  async saveRule(rule) {
    const body = pickKeys(rule, ['name', 'severities', 'modules', 'scope', 'integrationIds', 'enabled'])
    await mutate(() => (rule.id ? http('PUT', `/routing-rules/${rule.id}`, body) : http('POST', '/routing-rules', body)))
  },
  async deleteRule(id) { await mutate(() => http('DELETE', `/routing-rules/${id}`)) },

  // organisation / settings
  async updateMemberRole(id, role) { await mutate(() => http('PATCH', `/members/${id}`, { role })) },
  async inviteMember(email, role) { await mutate(() => http('POST', '/members', { email: email.trim(), role })) },
  async removeMember(id) { await mutate(() => http('DELETE', `/members/${id}`)) },
  async createToken(name, scopes) { const r = await mutate(() => http('POST', '/tokens', { name, scopes })); return r.token },
  async revokeToken(id) { await mutate(() => http('DELETE', `/tokens/${id}`)) },
  async saveSettings(patch) {
    const r = await http('PUT', '/settings', patch)
    setState({ settings: r })
    if (patch.timezone) setTimezone(patch.timezone)
  },
  async createWorkspace(name) {
    const w = await http('POST', '/workspaces', { name })
    const me = await http('GET', '/auth/me')
    setState({ workspaces: me.workspaces })
    await api.switchWorkspace(w.id)
  },
  async switchWorkspace(id) {
    setAuth(getAuth().token, id)
    try { await hydrate() } catch (e) { toast('error', e.message); return }
    setState({ workspaceId: id })
    rt?.reconnect()
    toast('success', 'Switched workspace')
  },
  markNotificationsRead() { const t = Date.now(); setState({ lastRead: t }); storageSet('local', 'lw_lastread', String(t)) },

  // reports are computed by the backend from stored metrics and alert history
  async runReport(type, from, to) { return http('GET', `/reports/${type}?from=${from}&to=${to}`) },
}
