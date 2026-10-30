// Policy resolution + health evaluation (pure functions, shared by UI and API layer)
export const SPECIFICITY = { server: 5, tag: 4, region: 3, environment: 3, client: 2, global: 1 }

export function policyApplies(policy, server) {
  if (!policy.enabled) return 0
  let best = policy.isDefault ? SPECIFICITY.global : 0
  for (const a of policy.assignments || []) {
    const hit =
      (a.type === 'server' && a.value === server.id) ||
      (a.type === 'client' && a.value === server.client) ||
      (a.type === 'environment' && a.value === server.env) ||
      (a.type === 'region' && a.value === server.region) ||
      (a.type === 'tag' && server.tags.includes(a.value))
    if (hit) best = Math.max(best, SPECIFICITY[a.type])
  }
  return best
}
export function effectivePolicy(server, policies) {
  let best = null, score = 0
  for (const p of policies) {
    const s = policyApplies(p, server)
    if (s > score) { best = p; score = s }
  }
  return best || policies.find((p) => p.isDefault) || policies[0]
}
export const sevFor = (v, t) => (v >= t.crit ? 'critical' : v >= t.warn ? 'warning' : null)

export function failedServices(server) { return (server.services || []).filter((s) => s.monitored && (s.status === 'failed' || s.status === 'inactive')) }

export function serverHealth(server, policy) {
  if (!server.agentOnline) return 'offline'
  const sevs = [sevFor(server.cpu, policy.cpu), sevFor(server.mem, policy.memory), sevFor(server.disk, policy.disk)]
  if (server.netIn >= policy.network.inMbps || server.netOut >= policy.network.outMbps) sevs.push('critical')
  if (failedServices(server).length) sevs.push('critical')
  if (sevs.includes('critical')) return 'critical'
  if (sevs.includes('warning')) return 'warning'
  return 'healthy'
}
export function suppressionMatches(s, server, module, now) {
  if (s.endedAt) return false
  if (s.expiresAt && s.expiresAt <= now) return false
  if (!(s.modules.includes('all') || s.modules.includes(module))) return false
  const [kind, ...rest] = s.target.split(':'); const val = rest.join(':')
  if (kind === 'server') return val === server.id
  if (kind === 'client') return val === server.client
  if (kind === 'env') return val === server.env
  if (kind === 'region') return val === server.region
  if (kind === 'all') return true
  return false
}
export const MODULES = [
  { id: 'cpu', label: 'CPU', icon: 'cpu' },
  { id: 'memory', label: 'RAM', icon: 'memory' },
  { id: 'disk', label: 'Disk', icon: 'disk' },
  { id: 'network', label: 'Network', icon: 'activity' },
  { id: 'processes', label: 'Processes', icon: 'list' },
  { id: 'services', label: 'Services', icon: 'box' },
  { id: 'availability', label: 'Availability', icon: 'power' },
]
export const moduleLabel = (id) => (id === 'all' ? 'All modules' : MODULES.find((m) => m.id === id)?.label || id)
export const DURATIONS = [
  { id: '15m', label: '15 minutes', min: 15 },
  { id: '30m', label: '30 minutes', min: 30 },
  { id: '1h', label: '1 hour', min: 60 },
  { id: '4h', label: '4 hours', min: 240 },
  { id: '24h', label: '24 hours', min: 1440 },
  { id: 'manual', label: 'Until manually enabled', min: null },
]
