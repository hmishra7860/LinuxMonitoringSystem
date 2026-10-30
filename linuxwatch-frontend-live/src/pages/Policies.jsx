import { useMemo, useState } from 'react'
import { Icon } from '../lib/icons.jsx'
import { Badge, Banner, Button, Card, Confirm, Empty, Menu, Modal } from '../components/ui.jsx'
import { Field, Input, NumberInput, Select, Textarea, Toggle } from '../components/forms.jsx'
import { useStore } from '../api/store.js'
import { api, toast } from '../api/client.js'
import { effectivePolicy } from '../lib/health.js'
import { ENVS, REGIONS } from '../data/constants.js'
import { useClients } from './AddServerWizard.jsx'

export function validatePolicy(f, policies, requireName = true) {
  const e = {}
  if (requireName) {
    if (f.name.trim().length < 3) e.name = 'Enter a policy name (min. 3 characters).'
    else if (policies.some((p) => p.id !== f.id && p.name.toLowerCase() === f.name.trim().toLowerCase())) e.name = 'A policy with this name already exists.'
  }
  for (const m of ['cpu', 'memory', 'disk']) {
    const t = f[m]
    if (t.warn === '' || t.crit === '' || !(t.warn >= 1 && t.crit <= 100)) e[m] = 'Thresholds must be between 1 and 100.'
    else if (t.warn >= t.crit) e[m] = 'Warning must be lower than critical.'
    else if (!(t.duration >= 1)) e[m] = 'Duration must be at least 1 minute.'
  }
  if (!(f.network.inMbps > 0 && f.network.outMbps > 0 && f.network.errors >= 0 && f.network.errors !== '')) e.network = 'Enter positive limits for inbound, outbound and packet errors.'
  if (!(f.service.failAfter >= 1)) e.service = 'Failure detection duration must be at least 1 minute.'
  if (!f.isDefault && requireName && !f.assignments.length) e.assignments = 'Assign the policy to at least one server or group, or make it the global default.'
  return e
}

export function PolicyFields({ f, set, errs }) {
  const mod = (m, label) => (
    <div key={m} className="col" style={{ gap: 6 }}>
      <div className="lbl">{label}</div>
      <div className="row wrap" style={{ gap: 12 }}>
        <Field label="Warning"><NumberInput width={110} value={f[m].warn} suffix="%" min={1} max={100} error={errs[m]} onChange={(v) => set({ [m]: { ...f[m], warn: v } })} /></Field>
        <Field label="Critical"><NumberInput width={110} value={f[m].crit} suffix="%" min={1} max={100} error={errs[m]} onChange={(v) => set({ [m]: { ...f[m], crit: v } })} /></Field>
        <Field label="Evaluation duration"><NumberInput width={120} value={f[m].duration} suffix="min" min={1} max={1440} error={errs[m]} onChange={(v) => set({ [m]: { ...f[m], duration: v } })} /></Field>
      </div>
      {errs[m] && <span className="err-text">{errs[m]}</span>}
    </div>
  )
  return (
    <div className="col" style={{ gap: 16 }}>
      {mod('cpu', 'CPU')}{mod('memory', 'Memory')}{mod('disk', 'Disk')}
      <div className="col" style={{ gap: 6 }}>
        <div className="lbl">Network</div>
        <div className="row wrap" style={{ gap: 12 }}>
          <Field label="Incoming traffic"><NumberInput width={130} value={f.network.inMbps} suffix="Mbps" min={1} max={100000} error={errs.network} onChange={(v) => set({ network: { ...f.network, inMbps: v } })} /></Field>
          <Field label="Outgoing traffic"><NumberInput width={130} value={f.network.outMbps} suffix="Mbps" min={1} max={100000} error={errs.network} onChange={(v) => set({ network: { ...f.network, outMbps: v } })} /></Field>
          <Field label="Packet errors"><NumberInput width={130} value={f.network.errors} suffix="/ min" min={0} max={1000000} error={errs.network} onChange={(v) => set({ network: { ...f.network, errors: v } })} /></Field>
        </div>
        {errs.network && <span className="err-text">{errs.network}</span>}
      </div>
      <div className="col" style={{ gap: 6 }}>
        <div className="lbl">Service monitoring</div>
        <div className="row wrap" style={{ gap: 12 }}>
          <Field label="Expected service status"><Select value={f.service.expected} onChange={(e) => set({ service: { ...f.service, expected: e.target.value } })} options={[{ value: 'active', label: 'Active (running)' }]} /></Field>
          <Field label="Failure detection duration"><NumberInput width={120} value={f.service.failAfter} suffix="min" min={1} max={1440} error={errs.service} onChange={(v) => set({ service: { ...f.service, failAfter: v } })} /></Field>
        </div>
        {errs.service && <span className="err-text">{errs.service}</span>}
      </div>
    </div>
  )
}

const ASSIGN_LABEL = { server: 'Server', client: 'Client', environment: 'Environment', region: 'Region', tag: 'Tag' }

function PolicyModal({ policy, onClose }) {
  const policies = useStore((s) => s.policies)
  const servers = useStore((s) => s.servers)
  const clients = useClients()
  const [f, setF] = useState(policy || { name: '', description: '', isDefault: false, enabled: true, assignments: [], cpu: { warn: 75, crit: 90, duration: 5 }, memory: { warn: 80, crit: 90, duration: 5 }, disk: { warn: 80, crit: 90, duration: 10 }, network: { inMbps: 800, outMbps: 800, errors: 50 }, service: { expected: 'active', failAfter: 2 } })
  const [errs, setErrs] = useState({})
  const [busy, setBusy] = useState(false)
  const [aType, setAType] = useState('environment')
  const [aVal, setAVal] = useState('')
  const set = (p) => setF((x) => ({ ...x, ...p }))
  const tags = useMemo(() => [...new Set(servers.flatMap((s) => s.tags))].sort(), [servers])
  const options = { server: servers.map((s) => ({ value: s.id, label: s.name })), client: clients.map((c) => ({ value: c, label: c })), environment: ENVS.map((c) => ({ value: c, label: c })), region: REGIONS.map((c) => ({ value: c, label: c })), tag: tags.map((c) => ({ value: c, label: c })) }[aType]
  const labelOf = (a) => (a.type === 'server' ? servers.find((s) => s.id === a.value)?.name || a.value : a.value)
  const addAssign = () => { if (!aVal || f.assignments.some((a) => a.type === aType && a.value === aVal)) return; set({ assignments: [...f.assignments, { type: aType, value: aVal }] }); setAVal('') }
  const save = async () => {
    const e = validatePolicy(f, policies)
    setErrs(e)
    if (Object.keys(e).length) return
    setBusy(true)
    try { const r = await api.savePolicy({ ...f, name: f.name.trim(), assignments: f.isDefault ? [] : f.assignments }); toast('success', `Policy saved${r.notified ? ` — ${r.notified} new alert notification(s) sent` : ''}`); onClose() } catch (er) { toast('error', er.message); setBusy(false) }
  }
  return (
    <Modal title={policy ? 'Edit alert policy' : 'Create alert policy'} size="lg" onClose={onClose} footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save policy</Button></>}>
      <div className="form-grid">
        <Field label="Policy name" required error={errs.name}><Input value={f.name} onChange={(e) => set({ name: e.target.value })} error={errs.name} placeholder="e.g. Database servers" autoFocus /></Field>
        <Field label="Status"><div className="row" style={{ height: 36 }}><Toggle on={f.enabled} onChange={(v) => set({ enabled: v })} label="Enabled" /><span>{f.enabled ? 'Enabled' : 'Disabled'}</span></div></Field>
        <Field className="full" label="Description"><Textarea value={f.description} onChange={(e) => set({ description: e.target.value })} style={{ minHeight: 52 }} /></Field>
      </div>
      <div className="row"><Toggle on={f.isDefault} onChange={(v) => set({ isDefault: v })} label="Global default" /><div><b>Global default policy</b><div className="small muted">Applies to every server that has no more specific policy assigned.</div></div></div>
      {!f.isDefault && (
        <Field label="Assign to" required error={errs.assignments} hint="Most specific wins: server → tag → environment / region → client → global default.">
          <div className="row wrap">
            <Select style={{ width: 'auto' }} value={aType} onChange={(e) => { setAType(e.target.value); setAVal('') }} options={Object.entries(ASSIGN_LABEL).map(([value, label]) => ({ value, label }))} />
            <Select style={{ width: 'auto', minWidth: 180 }} value={aVal} onChange={(e) => setAVal(e.target.value)}><option value="">Select…</option>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
            <Button size="sm" icon="plus" onClick={addAssign} disabled={!aVal}>Add</Button>
          </div>
          <div className="chips" style={{ marginTop: 6 }}>{f.assignments.map((a) => <span key={a.type + a.value} className="chip">{ASSIGN_LABEL[a.type]}: {labelOf(a)}<button aria-label="Remove assignment" onClick={() => set({ assignments: f.assignments.filter((x) => x !== a) })}><Icon name="x" size={12} /></button></span>)}</div>
        </Field>
      )}
      <PolicyFields f={f} set={set} errs={errs} />
    </Modal>
  )
}

export function PoliciesTab() {
  const policies = useStore((s) => s.policies)
  const servers = useStore((s) => s.servers)
  const [edit, setEdit] = useState(null)
  const [del, setDel] = useState(null)
  const counts = useMemo(() => { const c = {}; servers.forEach((s) => { const p = effectivePolicy(s, policies); c[p.id] = (c[p.id] || 0) + 1 }); return c }, [servers, policies])
  return (
    <>
      <div className="row wrap"><p className="muted" style={{ flex: 1, minWidth: 260 }}>Thresholds are configured per monitoring module. Policies can be assigned to servers, clients, environments, regions or tags.</p><Button variant="primary" icon="plus" onClick={() => setEdit('new')}>Create policy</Button></div>
      {!policies.length ? <Card><Empty icon="shield" title="No policies" action={<Button variant="primary" onClick={() => setEdit('new')}>Create policy</Button>} /></Card> : (
        <div className="grid g2">
          {policies.map((p) => (
            <Card key={p.id} title={<span className="row">{p.name}{p.isDefault && <Badge tone="info">Global default</Badge>}{!p.enabled && <Badge>Disabled</Badge>}</span>} subtitle={p.description} actions={<>
              <Toggle on={p.enabled} label={`Enable ${p.name}`} onChange={async (v) => { try { await api.savePolicy({ ...p, enabled: v }); toast('success', v ? 'Policy enabled' : 'Policy disabled') } catch (e) { toast('error', e.message) } }} />
              <Menu items={[{ label: 'Edit policy', icon: 'edit', onClick: () => setEdit(p) }, { sep: true }, { label: 'Delete policy', icon: 'trash', danger: true, onClick: () => setDel(p) }]} /></>}>
              <div className="kv" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
                {[['CPU', p.cpu], ['Memory', p.memory], ['Disk', p.disk]].map(([l, t]) => <div key={l}><div className="k">{l}</div><div className="v"><span className="tone-warn">{t.warn}%</span> / <span className="tone-crit">{t.crit}%</span><div className="small muted">for {t.duration} min</div></div></div>)}
                <div><div className="k">Network in / out</div><div className="v">{p.network.inMbps} / {p.network.outMbps} <span className="small muted">Mbps</span><div className="small muted">{p.network.errors} errors/min</div></div></div>
                <div><div className="k">Service</div><div className="v">{p.service.expected}<div className="small muted">fail after {p.service.failAfter} min</div></div></div>
                <div><div className="k">Applies to</div><div className="v">{counts[p.id] || 0} servers</div></div>
              </div>
              <div className="chips" style={{ marginTop: 12 }}>{p.isDefault ? <span className="chip">All servers without a specific policy</span> : p.assignments.map((a) => <span key={a.type + a.value} className="chip">{ASSIGN_LABEL[a.type]}: {a.type === 'server' ? servers.find((s) => s.id === a.value)?.name || a.value : a.value}</span>)}</div>
            </Card>
          ))}
        </div>
      )}
      {edit && <PolicyModal policy={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {del && <Confirm danger title="Delete alert policy?" confirmLabel="Delete policy" message={<>Servers assigned to <b>{del.name}</b> will fall back to their next most specific policy (or the global default). Open alerts are re-evaluated.</>} onCancel={() => setDel(null)} onConfirm={async () => { try { await api.deletePolicy(del.id); toast('success', 'Policy deleted') } catch (e) { toast('error', e.message) } setDel(null) }} />}
    </>
  )
}
