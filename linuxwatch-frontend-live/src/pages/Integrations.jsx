import { useMemo, useState } from 'react'
import { Icon } from '../lib/icons.jsx'
import { Badge, Banner, Button, Card, Confirm, DataTable, Empty, Menu, Modal, PageHeader, StatusBadge, Tabs } from '../components/ui.jsx'
import { ChipsInput, Checkbox, Field, Input, PasswordInput, Select, Textarea, Toggle } from '../components/forms.jsx'
import { useStore } from '../api/store.js'
import { api, toast } from '../api/client.js'
import { MODULES, moduleLabel } from '../lib/health.js'
import { fmtDateTime, isEmail, isUrl, timeAgo } from '../lib/utils.js'
import { useClients } from './AddServerWizard.jsx'
import { ENVS } from '../data/constants.js'

const TYPES = {
  email: { label: 'Email (SMTP)', icon: 'mail', blurb: 'Send alert emails through your SMTP server.' },
  slack: { label: 'Slack', icon: 'hash', blurb: 'Post alerts to a Slack channel via incoming webhook.' },
  teams: { label: 'Microsoft Teams', icon: 'users', blurb: 'Deliver alerts to a Teams channel webhook.' },
  webhook: { label: 'Generic webhook', icon: 'webhook', blurb: 'POST JSON to any HTTP endpoint.' },
}
const DEFAULT_TEMPLATE = '{\n  "alert": "{{alert.id}}",\n  "server": "{{server.name}}",\n  "severity": "{{alert.severity}}",\n  "metric": "{{alert.metric}}",\n  "value": "{{alert.value}}",\n  "threshold": "{{alert.threshold}}"\n}'
const blank = (type) => ({
  type, name: TYPES[type].label, enabled: true,
  config: { email: { host: '', port: 587, security: 'STARTTLS', sender: '', username: '', recipients: [] }, slack: { channel: '#alerts' }, teams: {}, webhook: { url: '', method: 'POST', auth: 'none', headers: [], template: DEFAULT_TEMPLATE } }[type],
})

function IntegrationModal({ integration, type, onClose }) {
  const [f, setF] = useState(integration ? { ...integration, config: JSON.parse(JSON.stringify(integration.config)) } : blank(type))
  const t = f.type
  const saved = !!integration
  const [secrets, setSecrets] = useState({ password: '', webhookUrl: '', token: '' })
  const [errs, setErrs] = useState({})
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState(null)
  const c = f.config
  const setC = (p) => setF((x) => ({ ...x, config: { ...x.config, ...p } }))
  const hasSecret = (k) => saved && integration.secrets[k]
  const secretHint = (k) => (hasSecret(k) ? 'A value is stored securely. Leave blank to keep it, or type a new one to replace it.' : undefined)
  const secretPh = (k) => (hasSecret(k) ? '•••••••••••• (saved)' : '')

  const validate = () => {
    const e = {}
    if (f.name.trim().length < 2) e.name = 'Enter a name.'
    if (t === 'email') {
      if (!c.host.trim()) e.host = 'SMTP host is required.'
      if (!(c.port >= 1 && c.port <= 65535)) e.port = 'Port must be 1–65535.'
      if (!isEmail(c.sender)) e.sender = 'Enter a valid sender address.'
      if (!c.username.trim()) e.username = 'Username is required.'
      if (!secrets.password && !hasSecret('password')) e.password = 'Password or app password is required.'
      if (!c.recipients.length) e.recipients = 'Add at least one recipient.'
    }
    if (t === 'slack' || t === 'teams') {
      if (!secrets.webhookUrl && !hasSecret('webhookUrl')) e.webhookUrl = 'Webhook URL is required.'
      else if (secrets.webhookUrl && !isUrl(secrets.webhookUrl, true)) e.webhookUrl = 'Enter a valid https:// webhook URL.'
      if (t === 'slack' && !/^[#@][\w.-]+$/.test(c.channel)) e.channel = 'Use a channel like #ops-alerts.'
    }
    if (t === 'webhook') {
      if (!isUrl(c.url)) e.url = 'Enter a valid http(s) endpoint URL.'
      if (c.auth !== 'none' && !secrets.token && !hasSecret('token')) e.token = 'Credentials are required for this auth type.'
      try { JSON.parse(c.template.replace(/\{\{[^}]+\}\}/g, 'x')) } catch { e.template = 'Payload template must be valid JSON (placeholders like {{alert.id}} are allowed).' }
      if (c.headers.some((h) => !h.k.trim() || /\s/.test(h.k))) e.headers = 'Header names are required and cannot contain spaces.'
    }
    setErrs(e)
    return !Object.keys(e).length
  }
  const nonEmpty = () => Object.fromEntries(Object.entries(secrets).filter(([, v]) => v))
  const test = async () => {
    if (!validate()) return
    setTesting(true); setResult(null)
    setResult(await api.testIntegration(saved ? integration.id : f, nonEmpty()))
    setTesting(false)
  }
  const save = async () => {
    if (!validate()) return
    setBusy(true)
    try { await api.saveIntegration({ ...f, name: f.name.trim() }, nonEmpty()); toast('success', `${f.name} saved`); onClose() } catch (e) { toast('error', e.message); setBusy(false) }
  }
  return (
    <Modal title={`${saved ? 'Edit' : 'Add'} ${TYPES[t].label}`} size="lg" onClose={onClose} footer={<><Button icon="send" onClick={test} loading={testing} disabled={busy}>Send test</Button><div className="spacer" /><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save integration</Button></>}>
      <Field label="Integration name" required error={errs.name}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={errs.name} /></Field>
      {t === 'email' && (
        <div className="form-grid">
          <Field label="SMTP host" required error={errs.host}><Input value={c.host} onChange={(e) => setC({ host: e.target.value })} error={errs.host} placeholder="smtp.example.com" /></Field>
          <Field label="SMTP port" required error={errs.port}><Input type="number" value={c.port} onChange={(e) => setC({ port: +e.target.value })} error={errs.port} /></Field>
          <Field label="TLS / SSL"><Select value={c.security} onChange={(e) => setC({ security: e.target.value, port: { STARTTLS: 587, 'SSL/TLS': 465, None: 25 }[e.target.value] })} options={['STARTTLS', 'SSL/TLS', 'None']} /></Field>
          <Field label="Sender email" required error={errs.sender}><Input type="email" value={c.sender} onChange={(e) => setC({ sender: e.target.value })} error={errs.sender} placeholder="alerts@company.com" /></Field>
          <Field label="Username" required error={errs.username}><Input value={c.username} onChange={(e) => setC({ username: e.target.value })} error={errs.username} autoComplete="off" /></Field>
          <Field label="Password / app password" required error={errs.password} hint={secretHint('password')}><PasswordInput value={secrets.password} onChange={(e) => setSecrets({ ...secrets, password: e.target.value })} error={errs.password} placeholder={secretPh('password')} /></Field>
          <Field className="full" label="Recipient email addresses" required error={errs.recipients}><ChipsInput values={c.recipients} onChange={(recipients) => setC({ recipients })} validate={isEmail} placeholder="oncall@company.com" /></Field>
          {c.security === 'None' && <div className="full"><Banner tone="warn" icon="alert">Unencrypted SMTP sends credentials and alert content in clear text. Use STARTTLS or SSL/TLS.</Banner></div>}
        </div>
      )}
      {(t === 'slack' || t === 'teams') && (
        <div className="col">
          <Field label="Webhook URL" required error={errs.webhookUrl} hint={secretHint('webhookUrl') || 'Webhook URLs are secrets: stored encrypted and never displayed again.'}><PasswordInput value={secrets.webhookUrl} onChange={(e) => setSecrets({ ...secrets, webhookUrl: e.target.value })} error={errs.webhookUrl} placeholder={secretPh('webhookUrl') || 'https://hooks.example.com/services/…'} /></Field>
          {t === 'slack' && <Field label="Channel" required error={errs.channel}><Input value={c.channel} onChange={(e) => setC({ channel: e.target.value })} error={errs.channel} placeholder="#ops-alerts" /></Field>}
        </div>
      )}
      {t === 'webhook' && (
        <div className="col" style={{ gap: 14 }}>
          <div className="form-grid">
            <Field label="Endpoint URL" required error={errs.url} className="full"><Input value={c.url} onChange={(e) => setC({ url: e.target.value })} error={errs.url} placeholder="https://hooks.example.com/incidents" /></Field>
            <Field label="HTTP method"><Select value={c.method} onChange={(e) => setC({ method: e.target.value })} options={['POST', 'PUT', 'PATCH']} /></Field>
            <Field label="Authentication"><Select value={c.auth} onChange={(e) => setC({ auth: e.target.value })} options={[{ value: 'none', label: 'None' }, { value: 'bearer', label: 'Bearer token' }, { value: 'basic', label: 'Basic (user:password)' }, { value: 'header', label: 'API key header' }]} /></Field>
            {c.auth !== 'none' && <Field className="full" label={c.auth === 'basic' ? 'user:password' : c.auth === 'header' ? 'API key' : 'Token'} required error={errs.token} hint={secretHint('token')}><PasswordInput value={secrets.token} onChange={(e) => setSecrets({ ...secrets, token: e.target.value })} error={errs.token} placeholder={secretPh('token')} /></Field>}
          </div>
          <Field label="Custom headers" error={errs.headers}>
            <div className="col" style={{ gap: 6 }}>
              {c.headers.map((h, i) => (
                <div key={i} className="row"><Input className="sm" placeholder="Header" value={h.k} onChange={(e) => setC({ headers: c.headers.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)) })} /><Input className="sm" placeholder="Value" value={h.v} onChange={(e) => setC({ headers: c.headers.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)) })} /><Button size="sm" variant="ghost" aria-label="Remove header" onClick={() => setC({ headers: c.headers.filter((_, j) => j !== i) })}><Icon name="x" size={14} /></Button></div>
              ))}
              <div><Button size="sm" icon="plus" onClick={() => setC({ headers: [...c.headers, { k: '', v: '' }] })}>Add header</Button></div>
            </div>
          </Field>
          <Field label="JSON payload template" error={errs.template} hint="Placeholders: {{alert.id}}, {{alert.severity}}, {{alert.metric}}, {{alert.value}}, {{alert.threshold}}, {{server.name}}"><Textarea className="mono" style={{ minHeight: 150, fontFamily: 'var(--mono)' }} value={c.template} onChange={(e) => setC({ template: e.target.value })} error={errs.template} spellCheck={false} /></Field>
        </div>
      )}
      {result && <Banner tone={result.ok ? 'ok' : 'crit'} icon={result.ok ? 'checkCircle' : 'alert'}>{result.message}{result.latency ? ` (${result.latency} ms)` : ''} {!saved && result.ok && <span className="muted">Save to enable delivery.</span>}</Banner>}
    </Modal>
  )
}

function RuleModal({ rule, onClose }) {
  const integrations = useStore((s) => s.integrations)
  const servers = useStore((s) => s.servers)
  const clients = useClients()
  const [f, setF] = useState(rule || { name: '', severities: ['critical'], modules: [], scope: { type: 'all', value: '' }, integrationIds: [], enabled: true })
  const [errs, setErrs] = useState({})
  const [busy, setBusy] = useState(false)
  const tog = (k, v) => setF((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((i) => i !== v) : [...x[k], v] }))
  const scopeOpts = { client: clients.map((c) => ({ value: c, label: c })), server: servers.map((s) => ({ value: s.id, label: s.name })), environment: ENVS.map((c) => ({ value: c, label: c })) }[f.scope.type] || []
  const save = async () => {
    const e = {}
    if (f.name.trim().length < 3) e.name = 'Enter a rule name.'
    if (!f.severities.length) e.severities = 'Choose at least one severity.'
    if (!f.modules.length) e.modules = 'Choose at least one module.'
    if (f.scope.type !== 'all' && !f.scope.value) e.scope = 'Choose the server or group.'
    if (!f.integrationIds.length) e.integrationIds = 'Choose at least one destination.'
    setErrs(e)
    if (Object.keys(e).length) return
    setBusy(true); await api.saveRule({ ...f, name: f.name.trim() }); toast('success', 'Routing rule saved'); onClose()
  }
  const allMods = f.modules.includes('all')
  return (
    <Modal title={rule ? 'Edit routing rule' : 'New routing rule'} onClose={onClose} footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save rule</Button></>}>
      <Field label="Rule name" required error={errs.name}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={errs.name} placeholder="Critical CPU → Email + Slack" /></Field>
      <Field label="Severity" required error={errs.severities}><div className="row" style={{ gap: 16 }}>{['critical', 'warning'].map((s) => <Checkbox key={s} checked={f.severities.includes(s)} onChange={() => tog('severities', s)}>{s[0].toUpperCase() + s.slice(1)}</Checkbox>)}</div></Field>
      <Field label="Monitoring module" required error={errs.modules}><div className="row wrap" style={{ gap: 14 }}><Checkbox checked={allMods} onChange={(v) => setF({ ...f, modules: v ? ['all'] : [] })}>All</Checkbox>{MODULES.map((m) => <Checkbox key={m.id} checked={allMods || f.modules.includes(m.id)} onChange={() => (allMods ? setF({ ...f, modules: MODULES.filter((x) => x.id !== m.id).map((x) => x.id) }) : tog('modules', m.id))}>{m.label}</Checkbox>)}</div></Field>
      <div className="form-grid">
        <Field label="Applies to"><Select value={f.scope.type} onChange={(e) => setF({ ...f, scope: { type: e.target.value, value: '' } })} options={[{ value: 'all', label: 'All servers' }, { value: 'client', label: 'Client / group' }, { value: 'environment', label: 'Environment' }, { value: 'server', label: 'Single server' }]} /></Field>
        {f.scope.type !== 'all' && <Field label="Target" required error={errs.scope}><Select value={f.scope.value} onChange={(e) => setF({ ...f, scope: { ...f.scope, value: e.target.value } })} error={errs.scope}><option value="">Select…</option>{scopeOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field>}
      </div>
      <Field label="Deliver to" required error={errs.integrationIds}>{!integrations.length ? <span className="muted">Add an integration first.</span> : <div className="col" style={{ gap: 6 }}>{integrations.map((i) => <Checkbox key={i.id} checked={f.integrationIds.includes(i.id)} onChange={() => tog('integrationIds', i.id)}><Icon name={TYPES[i.type].icon} size={14} /> {i.name} {!i.enabled && <Badge>Disabled</Badge>}</Checkbox>)}</div>}</Field>
    </Modal>
  )
}

export default function Integrations() {
  const integrations = useStore((s) => s.integrations)
  const rules = useStore((s) => s.rules)
  const deliveries = useStore((s) => s.deliveries)
  const servers = useStore((s) => s.servers)
  const now = useStore((s) => s.now)
  const [tab, setTab] = useState('integrations')
  const [modal, setModal] = useState(null)
  const [del, setDel] = useState(null)
  const [delRule, setDelRule] = useState(null)
  const [testing, setTesting] = useState('')
  const [picker, setPicker] = useState(false)
  const [simServer, setSimServer] = useState('')
  const [simBusy, setSimBusy] = useState(false)
  const [lastSim, setLastSim] = useState(null)
  const nameOf = (id) => integrations.find((i) => i.id === id)?.name || 'Deleted integration'
  const runTest = async (i) => {
    setTesting(i.id)
    const r = await api.testIntegration(i.id)
    toast(r.ok ? 'success' : 'error', r.ok ? `${i.name}: test notification delivered` : `${i.name}: ${r.message}`)
    setTesting('')
  }
  const simulate = async () => {
    setSimBusy(true)
    try { const r = await api.simulateAlert(simServer || servers.find((s) => s.agentOnline)?.id); setLastSim(r); toast(r.suppressed ? 'warn' : 'success', r.suppressed ? 'Alert created but notifications are suppressed' : `Alert fired → ${r.deliveries.length} notification(s) routed`) } catch (e) { toast('error', e.message) }
    setSimBusy(false)
  }
  return (
    <>
      <PageHeader title="Integrations" subtitle="Choose where alerts are delivered and how they are routed" actions={<Button variant="primary" icon="plus" onClick={() => setPicker(true)}>Add integration</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'integrations', label: 'Integrations', icon: 'plug', count: integrations.length }, { id: 'routing', label: 'Notification routing', icon: 'filter', count: rules.length }, { id: 'activity', label: 'Delivery log', icon: 'list' }]} />
      {tab === 'integrations' && (!integrations.length ? <Card><Empty icon="plug" title="No integrations yet" text="Connect Email, Slack, Microsoft Teams or a webhook to receive alerts." action={<Button variant="primary" onClick={() => setPicker(true)}>Add integration</Button>} /></Card> : (
        <div className="grid g2">
          {integrations.map((i) => (
            <Card key={i.id} className="int-card" style={{ padding: 0 }}>
              <div className="int-card">
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <div className="int-logo"><Icon name={TYPES[i.type].icon} size={19} /></div>
                  <div style={{ minWidth: 0, flex: 1 }}><b>{i.name}</b><div className="small muted">{TYPES[i.type].label}</div></div>
                  <Toggle on={i.enabled} label={`Enable ${i.name}`} onChange={() => api.toggleIntegration(i.id)} />
                  <Menu items={[{ label: 'Edit configuration', icon: 'edit', onClick: () => setModal({ integration: i }) }, { label: 'Send test notification', icon: 'send', onClick: () => runTest(i) }, { sep: true }, { label: 'Delete integration', icon: 'trash', danger: true, onClick: () => setDel(i) }]} />
                </div>
                <div className="row wrap"><StatusBadge status={i.enabled ? i.status : 'untested'} label={i.enabled ? undefined : 'Disabled'} />
                  {i.type === 'email' && <span className="small muted">{i.config.host}:{i.config.port} · {i.config.recipients.length} recipient(s)</span>}
                  {i.type === 'slack' && <span className="small muted">{i.config.channel}</span>}{i.type === 'webhook' && <span className="small muted mono">{i.config.method} {i.config.url}</span>}</div>
                <div className="small muted">Secrets: {Object.keys(i.secrets).length ? <span className="tone-ok">stored securely · hidden</span> : 'none'}</div>
                <div className="grid g2" style={{ gap: 8 }}>
                  <div><div className="faint small">Last successful delivery</div><div className="small">{i.lastSuccess ? timeAgo(i.lastSuccess, now) : 'never'}</div></div>
                  <div><div className="faint small">Last failure</div><div className={'small ' + (i.lastFailure ? 'tone-crit' : '')}>{i.lastFailure ? timeAgo(i.lastFailure, now) : 'none'}</div></div>
                </div>
                <div className="row"><Button size="sm" icon="send" loading={testing === i.id} onClick={() => runTest(i)}>Send test</Button><Button size="sm" icon="edit" onClick={() => setModal({ integration: i })}>Edit</Button></div>
              </div>
            </Card>
          ))}
        </div>
      ))}
      {tab === 'routing' && (
        <>
          <div className="row wrap"><p className="muted" style={{ flex: 1, minWidth: 260 }}>Rules decide which integrations receive an alert, based on severity, module, server or client group. A notification is sent once per matching destination. Suppressed alerts are never delivered.</p><Button variant="primary" icon="plus" onClick={() => setModal({ rule: 'new' })}>New rule</Button></div>
          <Card flush>
            {!rules.length ? <Empty icon="filter" title="No routing rules" text="Without rules, alerts are shown in the app but not delivered anywhere." /> : <DataTable rows={rules} columns={[
              { key: 'name', label: 'Rule', render: (r) => <b>{r.name}</b> },
              { key: 'severities', label: 'Severity', render: (r) => <div className="row" style={{ gap: 4 }}>{r.severities.map((s) => <Badge key={s} tone={s === 'critical' ? 'crit' : 'warn'}>{s}</Badge>)}</div> },
              { key: 'modules', label: 'Module', render: (r) => r.modules.map(moduleLabel).join(', ') },
              { key: 'scope', label: 'Applies to', render: (r) => (r.scope.type === 'all' ? 'All servers' : <span>{r.scope.type}: {r.scope.type === 'server' ? servers.find((s) => s.id === r.scope.value)?.name || r.scope.value : r.scope.value}</span>) },
              { key: 'to', label: 'Deliver to', render: (r) => <div className="row wrap" style={{ gap: 4 }}>{r.integrationIds.map((id) => <span key={id} className="chip">{nameOf(id)}</span>)}</div> },
              { key: 'enabled', label: 'On', render: (r) => <Toggle on={r.enabled} label={`Enable ${r.name}`} onChange={(v) => api.saveRule({ ...r, enabled: v })} /> },
              { key: 'a', label: '', render: (r) => <Menu items={[{ label: 'Edit rule', icon: 'edit', onClick: () => setModal({ rule: r }) }, { label: 'Delete rule', icon: 'trash', danger: true, onClick: () => setDelRule(r) }]} /> },
            ]} />}
          </Card>
        </>
      )}
      {tab === 'activity' && (
        <>
          <Card title="Try it: receive a notification" subtitle="Fires a simulated critical CPU alert through your routing rules">
            <div className="row wrap">
              <Select style={{ width: 'auto', minWidth: 200 }} value={simServer} onChange={(e) => setSimServer(e.target.value)} aria-label="Server"><option value="">Choose server (first online)</option>{servers.filter((s) => s.agentOnline).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
              <Button variant="primary" icon="bolt" loading={simBusy} onClick={simulate}>Simulate critical alert</Button>
              {lastSim && <span className="muted small">{lastSim.alert.id} → {lastSim.suppressed ? 'held back by suppression' : lastSim.deliveries.length ? lastSim.deliveries.map((d) => nameOf(d.integrationId)).join(', ') : 'no matching routing rule'}</span>}
            </div>
          </Card>
          <Card title="Delivery log" flush>
            {!deliveries.length ? <Empty icon="list" title="No deliveries yet" /> : <DataTable rows={deliveries} columns={[
              { key: 'ts', label: 'Time', render: (r) => <span className="muted">{fmtDateTime(r.ts, { second: '2-digit' })}</span> }, { key: 'integrationId', label: 'Destination', render: (r) => nameOf(r.integrationId) },
              { key: 'kind', label: 'Type', render: (r) => (r.kind === 'test' ? <Badge>Test</Badge> : <Badge tone="info">Alert {r.alertId}</Badge>) }, { key: 'summary', label: 'Message' }, { key: 'status', label: 'Result', render: (r) => <StatusBadge status={r.status} /> },
            ]} />}
          </Card>
        </>
      )}
      {picker && (
        <Modal title="Add integration" onClose={() => setPicker(false)}>
          <div className="grid g2">{Object.entries(TYPES).map(([k, t]) => <button key={k} className="card stat click" onClick={() => { setPicker(false); setModal({ type: k }) }}><div className="int-logo"><Icon name={t.icon} size={19} /></div><b>{t.label}</b><span className="small muted">{t.blurb}</span></button>)}</div>
        </Modal>
      )}
      {modal && !modal.rule && <IntegrationModal integration={modal.integration} type={modal.type} onClose={() => setModal(null)} />}
      {modal?.rule && <RuleModal rule={modal.rule === 'new' ? null : modal.rule} onClose={() => setModal(null)} />}
      {del && <Confirm danger title="Delete integration?" confirmLabel="Delete" message={<>Delete <b>{del.name}</b>? Its stored secrets are destroyed and it is removed from all routing rules.</>} onCancel={() => setDel(null)} onConfirm={async () => { await api.deleteIntegration(del.id); toast('success', 'Integration deleted'); setDel(null) }} />}
      {delRule && <Confirm danger title="Delete routing rule?" confirmLabel="Delete rule" message={<>Delete <b>{delRule.name}</b>?</>} onCancel={() => setDelRule(null)} onConfirm={async () => { await api.deleteRule(delRule.id); toast('success', 'Rule deleted'); setDelRule(null) }} />}
    </>
  )
}
