import { useMemo, useState } from 'react'
import { Icon } from '../lib/icons.jsx'
import { Banner, Badge, Button, Card, Confirm, DataTable, Empty, Modal, StatusBadge } from '../components/ui.jsx'
import { Checkbox, Field, Select, Textarea } from '../components/forms.jsx'
import { useStore } from '../api/store.js'
import { api, toast } from '../api/client.js'
import { DURATIONS, MODULES, moduleLabel } from '../lib/health.js'
import { fmtDateTime, fmtDuration } from '../lib/utils.js'
import { ENVS, REGIONS } from '../data/constants.js'
import { useClients } from './AddServerWizard.jsx'

export function SuppressModal({ initial = {}, onClose }) {
  const servers = useStore((s) => s.servers)
  const clients = useClients()
  const [scope, setScope] = useState(initial.scope || 'server')
  const [targetVal, setTargetVal] = useState(initial.value || '')
  const [modules, setModules] = useState(initial.modules || [])
  const [durationId, setDurationId] = useState('1h')
  const [reason, setReason] = useState('')
  const [errs, setErrs] = useState({})
  const [busy, setBusy] = useState(false)
  const opts = scope === 'server' ? servers.map((s) => ({ value: s.id, label: s.name })) : scope === 'client' ? clients.map((c) => ({ value: c, label: c })) : scope === 'env' ? ENVS.map((c) => ({ value: c, label: c })) : REGIONS.map((c) => ({ value: c, label: c }))
  const all = modules.includes('all')
  const toggle = (id) => setModules((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m.filter((x) => x !== 'all'), id]))
  const label = (() => { const o = opts.find((x) => x.value === targetVal); return o ? `${{ server: '', client: 'Client: ', env: 'Environment: ', region: 'Region: ' }[scope]}${o.label}` : '' })()
  const submit = async () => {
    const e = {}
    if (!targetVal) e.target = 'Choose what to suppress alerts for.'
    if (!modules.length) e.modules = 'Select at least one monitoring module.'
    if (reason.length > 300) e.reason = 'Keep the reason under 300 characters.'
    setErrs(e)
    if (Object.keys(e).length) return
    setBusy(true)
    try { await api.createSuppression({ target: `${scope}:${targetVal}`, targetLabel: label, modules, durationId, reason }); toast('success', 'Alerts suppressed — metric collection continues'); onClose() } catch (er) { toast('error', er.message); setBusy(false) }
  }
  return (
    <Modal title="Suppress alerts" onClose={onClose} footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" icon="pause" loading={busy} onClick={submit}>Suppress alerts</Button></>}>
      <Banner icon="info">Suppression only holds back alert generation and notifications. <b>Metrics keep being collected</b> and charted, and every suppression is recorded in the audit history.</Banner>
      <div className="form-grid">
        <Field label="Suppress for"><Select value={scope} onChange={(e) => { setScope(e.target.value); setTargetVal('') }} options={[{ value: 'server', label: 'Individual server' }, { value: 'client', label: 'Server group: client' }, { value: 'env', label: 'Server group: environment' }, { value: 'region', label: 'Server group: region' }]} /></Field>
        <Field label={scope === 'server' ? 'Server' : 'Group'} required error={errs.target}><Select value={targetVal} onChange={(e) => setTargetVal(e.target.value)} error={errs.target}><option value="">Select…</option>{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field>
      </div>
      <Field label="Monitoring modules" required error={errs.modules}>
        <div className="row wrap" style={{ gap: 14 }}>
          <Checkbox checked={all} onChange={(v) => setModules(v ? ['all'] : [])}>All modules</Checkbox>
          {MODULES.map((m) => <Checkbox key={m.id} checked={all || modules.includes(m.id)} onChange={() => (all ? setModules(MODULES.filter((x) => x.id !== m.id).map((x) => x.id)) : toggle(m.id))}>{m.label}</Checkbox>)}
        </div>
      </Field>
      <Field label="Duration"><Select value={durationId} onChange={(e) => setDurationId(e.target.value)} options={DURATIONS.map((d) => ({ value: d.id, label: d.label }))} /></Field>
      {durationId === 'manual' && <Banner tone="warn" icon="alert">Alerts stay suppressed until someone re-enables them manually.</Banner>}
      <Field label="Reason" error={errs.reason} hint="Shown in the audit history, e.g. “Planned maintenance window”."><Textarea value={reason} onChange={(e) => setReason(e.target.value)} error={errs.reason} maxLength={300} placeholder="Why are alerts being suppressed?" /></Field>
    </Modal>
  )
}

export function SuppressionsTab() {
  const sups = useStore((s) => s.suppressions)
  const audit = useStore((s) => s.suppressionAudit)
  const now = useStore((s) => s.now)
  const [creating, setCreating] = useState(false)
  const [ending, setEnding] = useState(null)
  const active = sups.filter((x) => !x.endedAt && (!x.expiresAt || x.expiresAt > now))
  const history = sups.filter((x) => !active.includes(x))
  return (
    <>
      <div className="row wrap"><p className="muted" style={{ flex: 1, minWidth: 260 }}>Suppress alerts during maintenance without losing visibility — data collection never stops.</p><Button variant="primary" icon="pause" onClick={() => setCreating(true)}>New suppression</Button></div>
      <Card title={`Active suppressions (${active.length})`} flush>
        {!active.length ? <Empty icon="checkCircle" title="No active suppressions" text="All configured alerts and notifications are live." /> : (
          <DataTable rows={active} columns={[
            { key: 'id', label: 'ID', render: (r) => <span className="mono">{r.id}</span> },
            { key: 'targetLabel', label: 'Scope', render: (r) => <b>{r.targetLabel}</b> },
            { key: 'modules', label: 'Modules', render: (r) => <div className="row wrap" style={{ gap: 4 }}>{r.modules.map((m) => <span key={m} className="chip">{moduleLabel(m)}</span>)}</div> },
            { key: 'expires', label: 'Ends', render: (r) => (r.expiresAt ? <>{fmtDateTime(r.expiresAt)}<div className="small muted">in {fmtDuration(r.expiresAt - now)}</div></> : <Badge tone="warn">Until manually enabled</Badge>) },
            { key: 'reason', label: 'Reason', render: (r) => <span className="muted">{r.reason || '—'}</span> },
            { key: 'by', label: 'By', render: (r) => r.createdBy },
            { key: 'act', label: '', render: (r) => <Button size="sm" onClick={() => setEnding(r)}>Unsuppress</Button> },
          ]} />
        )}
      </Card>
      <Card title="Audit history" subtitle="Every suppression, expiry and unsuppression" flush>
        <DataTable rows={audit} columns={[
          { key: 'ts', label: 'Time', render: (r) => <span className="muted">{fmtDateTime(r.ts, { year: 'numeric' })}</span> },
          { key: 'action', label: 'Action', render: (r) => <Badge tone={r.action === 'suppress' ? 'warn' : r.action === 'unsuppress' ? 'ok' : 'neutral'}>{r.action === 'suppress' ? 'Suppressed' : r.action === 'unsuppress' ? 'Unsuppressed' : 'Expired'}</Badge> },
          { key: 'suppressionId', label: 'ID', render: (r) => <span className="mono">{r.suppressionId}</span> },
          { key: 'user', label: 'User' }, { key: 'details', label: 'Details', render: (r) => <span className="muted">{r.details}</span> },
        ]} />
      </Card>
      {creating && <SuppressModal onClose={() => setCreating(false)} />}
      {ending && <Confirm title="Re-enable alerts?" confirmLabel="Unsuppress" message={<>Alerts and notifications for <b>{ending.targetLabel}</b> ({ending.modules.map(moduleLabel).join(', ')}) will resume immediately.</>} onCancel={() => setEnding(null)} onConfirm={async () => { await api.endSuppression(ending.id); toast('success', 'Alerting resumed'); setEnding(null) }} />}
    </>
  )
}
