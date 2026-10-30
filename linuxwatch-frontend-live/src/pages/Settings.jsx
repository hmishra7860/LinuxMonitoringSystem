import { useState } from 'react'
import { Icon } from '../lib/icons.jsx'
import { navigate } from '../lib/router.jsx'
import { useStore } from '../api/store.js'
import { api, toast } from '../api/client.js'
import { Badge, Banner, Button, Card, Confirm, CopyField, DataTable, Empty, Menu, Modal, PageHeader, Tabs } from '../components/ui.jsx'
import { Checkbox, ChipsInput, Field, Input, NumberInput, PasswordInput, Segmented, Select, Toggle } from '../components/forms.jsx'
import { PolicyFields, validatePolicy } from './Policies.jsx'
import { fmtDateTime, isEmail, passwordIssues, timeAgo } from '../lib/utils.js'

const TABS = [['profile', 'User profile', 'user'], ['organization', 'Organization', 'building'], ['roles', 'Roles & permissions', 'shield'], ['tokens', 'API tokens', 'key'], ['agent', 'Agent configuration', 'terminal'], ['thresholds', 'Default thresholds', 'bell'], ['timezone', 'Timezone', 'globe'], ['notifications', 'Notification preferences', 'mail'], ['audit', 'Audit logs', 'list']]
const TZ = ['UTC', 'Browser local', 'Asia/Kolkata', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney']
const ROLES = { Owner: 'Full access including billing and workspace deletion', Admin: 'Manage servers, policies, integrations and members', Operator: 'Acknowledge, resolve and suppress alerts; edit servers', Viewer: 'Read-only access to dashboards and reports' }
const PERMS = [['View dashboards & reports', [1, 1, 1, 1]], ['Acknowledge / resolve alerts', [1, 1, 1, 0]], ['Suppress alerts', [1, 1, 1, 0]], ['Add / edit servers', [1, 1, 1, 0]], ['Manage alert policies', [1, 1, 0, 0]], ['Manage integrations', [1, 1, 0, 0]], ['Manage members & roles', [1, 1, 0, 0]], ['API tokens', [1, 1, 0, 0]], ['Delete workspace', [1, 0, 0, 0]]]

function Profile() {
  const user = useStore((s) => s.users.find((u) => u.id === s.session?.userId))
  const [f, setF] = useState({ name: user.name, email: user.email })
  const [pw, setPw] = useState({ cur: '', next: '', conf: '' })
  const [e1, setE1] = useState({}); const [e2, setE2] = useState({})
  const [b1, setB1] = useState(false); const [b2, setB2] = useState(false)
  const saveProfile = async () => {
    const e = {}
    if (f.name.trim().length < 2) e.name = 'Enter your name.'
    if (!isEmail(f.email)) e.email = 'Enter a valid email.'
    setE1(e); if (Object.keys(e).length) return
    setB1(true); try { await api.updateProfile(f); toast('success', 'Profile updated') } catch (er) { setE1({ email: er.message }) } setB1(false)
  }
  const savePw = async () => {
    const e = {}
    if (!pw.cur) e.cur = 'Enter your current password.'
    const iss = passwordIssues(pw.next); if (iss.length) e.next = 'Needs ' + iss.join(', ') + '.'
    if (pw.next !== pw.conf) e.conf = 'Passwords do not match.'
    setE2(e); if (Object.keys(e).length) return
    setB2(true); try { await api.changePassword(pw.cur, pw.next); toast('success', 'Password changed'); setPw({ cur: '', next: '', conf: '' }) } catch (er) { setE2({ cur: er.message }) } setB2(false)
  }
  return (
    <div className="grid g2" style={{ alignItems: 'start' }}>
      <Card title="Profile"><div className="col" style={{ gap: 14 }}>
        <Field label="Full name" error={e1.name}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={e1.name} /></Field>
        <Field label="Email" error={e1.email}><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} error={e1.email} /></Field>
        <Field label="Company"><Input value={user.company} disabled /></Field>
        <div><Button variant="primary" loading={b1} onClick={saveProfile}>Save profile</Button></div>
      </div></Card>
      <Card title="Change password"><div className="col" style={{ gap: 14 }}>
        <Field label="Current password" error={e2.cur}><PasswordInput value={pw.cur} onChange={(e) => setPw({ ...pw, cur: e.target.value })} error={e2.cur} /></Field>
        <Field label="New password" error={e2.next}><PasswordInput value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} error={e2.next} /></Field>
        <Field label="Confirm new password" error={e2.conf}><PasswordInput value={pw.conf} onChange={(e) => setPw({ ...pw, conf: e.target.value })} error={e2.conf} /></Field>
        <div><Button variant="primary" loading={b2} onClick={savePw}>Update password</Button></div>
      </div></Card>
      <Card title="Session"><div className="row"><span className="muted">Signed in as {user.email}</span><div className="spacer" /><Button variant="danger" icon="logout" onClick={() => { api.logout(); navigate('/login') }}>Log out</Button></div></Card>
    </div>
  )
}

function Organization() {
  const members = useStore((s) => s.members)
  const workspaces = useStore((s) => s.workspaces)
  const wsId = useStore((s) => s.workspaceId)
  const servers = useStore((s) => s.servers)
  const [invite, setInvite] = useState(false)
  const [ws, setWs] = useState(false)
  const [rm, setRm] = useState(null)
  const [clear, setClear] = useState(false)
  const InviteM = () => {
    const [email, setEmail] = useState(''); const [role, setRole] = useState('Viewer'); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
    const go = async () => { if (!isEmail(email)) return setErr('Enter a valid email.'); setBusy(true); try { await api.inviteMember(email, role); toast('success', `Invitation sent to ${email}`); setInvite(false) } catch (e) { setErr(e.message); setBusy(false) } }
    return <Modal title="Invite member" onClose={() => setInvite(false)} size="sm" footer={<><Button onClick={() => setInvite(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={go}>Send invite</Button></>}><Field label="Email" error={err}><Input value={email} onChange={(e) => { setEmail(e.target.value); setErr('') }} error={err} autoFocus /></Field><Field label="Role"><Select value={role} onChange={(e) => setRole(e.target.value)} options={Object.keys(ROLES).filter((r) => r !== 'Owner')} /></Field></Modal>
  }
  const WsM = () => {
    const [name, setName] = useState(''); const [err, setErr] = useState('')
    const go = async () => { if (name.trim().length < 3) return setErr('Enter a workspace name.'); await api.createWorkspace(name.trim()); toast('success', 'Workspace created'); setWs(false) }
    return <Modal title="New workspace" onClose={() => setWs(false)} size="sm" footer={<><Button onClick={() => setWs(false)}>Cancel</Button><Button variant="primary" onClick={go}>Create</Button></>}><Field label="Workspace name" error={err}><Input value={name} onChange={(e) => setName(e.target.value)} error={err} autoFocus /></Field></Modal>
  }
  return (
    <>
      <Card title="Workspaces" actions={<Button size="sm" icon="plus" onClick={() => setWs(true)}>New workspace</Button>} flush>
        <DataTable rows={workspaces} columns={[{ key: 'name', label: 'Name', render: (r) => <b>{r.name}</b> }, { key: 'plan', label: 'Plan', render: (r) => <Badge>{r.plan}</Badge> }, { key: 'a', label: '', render: (r) => (r.id === wsId ? <Badge tone="ok" dot>Current</Badge> : <Button size="sm" onClick={() => api.switchWorkspace(r.id)}>Switch</Button>) }]} />
      </Card>
      <Card title="Members" actions={<Button size="sm" icon="plus" onClick={() => setInvite(true)}>Invite member</Button>} flush>
        <DataTable rows={members} columns={[
          { key: 'name', label: 'Name', render: (r) => <><b>{r.name}</b><div className="small muted">{r.email}</div></> },
          { key: 'role', label: 'Role', render: (r) => (r.role === 'Owner' ? <Badge tone="info">Owner</Badge> : <Select className="sm" style={{ width: 130 }} value={r.role} onChange={(e) => api.updateMemberRole(r.id, e.target.value)} options={Object.keys(ROLES).filter((x) => x !== 'Owner')} aria-label={`Role for ${r.name}`} />) },
          { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'Active' ? 'ok' : 'warn'} dot>{r.status}</Badge> }, { key: 'lastActive', label: 'Last active', render: (r) => <span className="muted">{r.lastActive}</span> },
          { key: 'a', label: '', render: (r) => r.role !== 'Owner' && <Button size="sm" variant="ghost" onClick={() => setRm(r)}>Remove</Button> },
        ]} />
      </Card>
      {invite && <InviteM />}{ws && <WsM />}
      {rm && <Confirm danger title="Remove member?" confirmLabel="Remove" message={<>Remove <b>{rm.name}</b> from this workspace? They lose access immediately.</>} onCancel={() => setRm(null)} onConfirm={async () => { await api.removeMember(rm.id); toast('success', 'Member removed'); setRm(null) }} />}
    </>
  )
}

function Roles() {
  return (
    <>
      <div className="grid g4">{Object.entries(ROLES).map(([r, d]) => <Card key={r}><b>{r}</b><div className="small muted" style={{ marginTop: 4 }}>{d}</div></Card>)}</div>
      <Card title="Permission matrix" flush><div className="tbl-wrap"><table className="tbl"><thead><tr><th>Permission</th>{Object.keys(ROLES).map((r) => <th key={r} style={{ textAlign: 'center' }}>{r}</th>)}</tr></thead><tbody>{PERMS.map(([p, v]) => <tr key={p}><td>{p}</td>{v.map((x, i) => <td key={i} style={{ textAlign: 'center' }}>{x ? <Icon name="check" className="tone-ok" /> : <span className="faint">—</span>}</td>)}</tr>)}</tbody></table></div></Card>
      <Banner icon="info">Roles are assigned per member under Settings → Organization. Enforcement happens in the backend API; this demo shows the model only.</Banner>
    </>
  )
}

function Tokens() {
  const tokens = useStore((s) => s.tokens)
  const [open, setOpen] = useState(false); const [secret, setSecret] = useState(''); const [rev, setRev] = useState(null)
  const [name, setName] = useState(''); const [scopes, setScopes] = useState(['metrics:read']); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const SC = ['metrics:read', 'servers:read', 'servers:write', 'alerts:read', 'alerts:write']
  const create = async () => {
    if (name.trim().length < 3) return setErr('Enter a token name (min. 3 characters).')
    if (!scopes.length) return setErr('Select at least one scope.')
    setBusy(true); setSecret(await api.createToken(name.trim(), scopes)); setBusy(false)
  }
  const close = () => { setOpen(false); setSecret(''); setName(''); setErr(''); setScopes(['metrics:read']) }
  return (
    <>
      <div className="row wrap"><p className="muted" style={{ flex: 1 }}>Personal API tokens authenticate scripts and CI against the REST API. A token is shown once, at creation.</p><Button variant="primary" icon="plus" onClick={() => setOpen(true)}>Create token</Button></div>
      <Card flush>{!tokens.length ? <Empty icon="key" title="No API tokens" /> : <DataTable rows={tokens} columns={[
        { key: 'name', label: 'Name', render: (r) => <b>{r.name}</b> }, { key: 'prefix', label: 'Token', render: (r) => <span className="mono muted">{r.prefix}••••••••••••</span> },
        { key: 'scopes', label: 'Scopes', render: (r) => <div className="row wrap" style={{ gap: 4 }}>{r.scopes.map((s) => <span key={s} className="chip">{s}</span>)}</div> },
        { key: 'createdAt', label: 'Created', render: (r) => <span className="muted">{fmtDateTime(r.createdAt, { year: 'numeric' })}</span> }, { key: 'lastUsed', label: 'Last used', render: (r) => <span className="muted">{r.lastUsed ? timeAgo(r.lastUsed) : 'never'}</span> },
        { key: 'a', label: '', render: (r) => <Button size="sm" variant="danger" onClick={() => setRev(r)}>Revoke</Button> },
      ]} />}</Card>
      {open && <Modal title={secret ? 'Token created' : 'Create API token'} onClose={close} size="sm" footer={secret ? <Button variant="primary" onClick={close}>Done</Button> : <><Button onClick={close}>Cancel</Button><Button variant="primary" loading={busy} onClick={create}>Create token</Button></>}>
        {secret ? <><Banner tone="warn" icon="lock">Copy this token now. For your security it will never be shown again.</Banner><CopyField value={secret} /></> : <>
          <Field label="Token name" error={err && !name.trim() || name.trim().length < 3 ? err : ''}><Input value={name} onChange={(e) => { setName(e.target.value); setErr('') }} placeholder="ci-deploy" autoFocus /></Field>
          <Field label="Scopes" error={!scopes.length ? err : ''}><div className="col" style={{ gap: 6 }}>{SC.map((s) => <Checkbox key={s} checked={scopes.includes(s)} onChange={(v) => setScopes(v ? [...scopes, s] : scopes.filter((x) => x !== s))}><span className="mono">{s}</span></Checkbox>)}</div></Field></>}
      </Modal>}
      {rev && <Confirm danger title="Revoke token?" confirmLabel="Revoke" message={<>Anything using <b>{rev.name}</b> stops working immediately.</>} onCancel={() => setRev(null)} onConfirm={async () => { await api.revokeToken(rev.id); toast('success', 'Token revoked'); setRev(null) }} />}
    </>
  )
}

function Agent() {
  const s = useStore((x) => x.settings)
  const [f, setF] = useState({ heartbeatSec: s.heartbeatSec, collectionSec: s.collectionSec, logLevel: s.logLevel, logSources: s.logSources, retentionDays: s.retentionDays })
  const [err, setErr] = useState({}); const [busy, setBusy] = useState(false)
  const save = async () => {
    const e = {}
    if (!(f.heartbeatSec >= 10 && f.heartbeatSec <= 300)) e.h = 'Heartbeat must be 10–300 seconds.'
    if (!(f.collectionSec >= 10 && f.collectionSec <= 600)) e.c = 'Collection interval must be 10–600 seconds.'
    if (!(f.retentionDays >= 1 && f.retentionDays <= 365)) e.r = 'Retention must be 1–365 days.'
    setErr(e); if (Object.keys(e).length) return
    setBusy(true); await api.saveSettings(f); toast('success', 'Agent defaults saved'); setBusy(false)
  }
  const yaml = `# /etc/linuxwatch/agent.yaml\nendpoint: https://<your-backend>/api/v1\ntoken: <server registration token>\nheartbeat_interval: ${f.heartbeatSec}s\ncollection_interval: ${f.collectionSec}s\nlog_level: ${f.logLevel}\nlog_sources:\n${f.logSources.map((x) => '  - ' + x).join('\n')}\ncollectors: [cpu, memory, disk, network, processes, services, logs]`
  return (
    <div className="grid g2" style={{ alignItems: 'start' }}>
      <Card title="Agent defaults" subtitle="Applied to newly registered agents"><div className="col" style={{ gap: 14 }}>
        <Field label="Heartbeat interval" error={err.h}><NumberInput width={140} min={10} max={300} suffix="seconds" value={f.heartbeatSec} error={err.h} onChange={(v) => setF({ ...f, heartbeatSec: v })} /></Field>
        <Field label="Metric collection interval" error={err.c}><NumberInput width={140} min={10} max={600} suffix="seconds" value={f.collectionSec} error={err.c} onChange={(v) => setF({ ...f, collectionSec: v })} /></Field>
        <Field label="Minimum log level"><Select value={f.logLevel} onChange={(e) => setF({ ...f, logLevel: e.target.value })} options={['INFO', 'WARNING', 'ERROR', 'CRITICAL']} /></Field>
        <Field label="Log sources"><ChipsInput values={f.logSources} onChange={(logSources) => setF({ ...f, logSources })} placeholder="journald, /var/log/syslog" /></Field>
        <Field label="Metric retention" error={err.r}><NumberInput width={140} min={1} max={365} suffix="days" value={f.retentionDays} error={err.r} onChange={(v) => setF({ ...f, retentionDays: v })} /></Field>
        <div><Button variant="primary" loading={busy} onClick={save}>Save defaults</Button></div>
      </div></Card>
      <Card title="Example agent.yaml"><CopyField multiline value={yaml} /><div className="hint" style={{ marginTop: 8 }}>The agent authenticates with its per-server registration token over HTTPS. Tokens are never shown in listings.</div></Card>
    </div>
  )
}

function Thresholds() {
  const policies = useStore((s) => s.policies)
  const def = policies.find((p) => p.isDefault)
  const [f, setF] = useState(def ? JSON.parse(JSON.stringify(def)) : null)
  const [errs, setErrs] = useState({}); const [busy, setBusy] = useState(false)
  if (!f) return <Empty icon="bell" title="No default policy" text="Create a global default under Alert Management → Alert Policies." />
  const save = async () => {
    const e = validatePolicy(f, policies, false); setErrs(e); if (Object.keys(e).length) return
    setBusy(true); try { await api.savePolicy(f); toast('success', 'Default thresholds saved') } catch (er) { toast('error', er.message) } setBusy(false)
  }
  return <Card title="Global default thresholds" subtitle="Used by every server without a more specific alert policy"><PolicyFields f={f} set={(p) => setF({ ...f, ...p })} errs={errs} /><div style={{ marginTop: 16 }}><Button variant="primary" loading={busy} onClick={save}>Save default thresholds</Button></div></Card>
}

function Timezone() {
  const s = useStore((x) => x.settings)
  const [tz, setTz] = useState(s.timezone); const [busy, setBusy] = useState(false)
  let preview = ''
  try { preview = new Intl.DateTimeFormat('en-GB', { timeZone: tz === 'Browser local' ? undefined : tz, dateStyle: 'medium', timeStyle: 'long' }).format(new Date()) } catch { preview = '—' }
  return <Card title="Timezone" subtitle="Applies to timestamps across the app"><div className="col" style={{ gap: 14, maxWidth: 420 }}><Field label="Display timezone"><Select value={tz} onChange={(e) => setTz(e.target.value)} options={TZ} /></Field><div className="muted">Now: <b style={{ color: 'var(--text)' }}>{preview}</b></div><div><Button variant="primary" loading={busy} onClick={async () => { setBusy(true); await api.saveSettings({ timezone: tz }); toast('success', 'Timezone updated'); setBusy(false) }}>Save timezone</Button></div></div></Card>
}

function Notifications() {
  const s = useStore((x) => x.settings)
  const set = (k, v) => api.saveSettings({ notif: { ...s.notif, [k]: v } })
  const rows = [['emailDigest', 'Daily email digest', 'A summary of alerts and availability each morning'], ['criticalPush', 'Critical alert notifications', 'Immediately notify me about critical alerts'], ['weeklyReport', 'Weekly availability report', 'Email the fleet report every Monday'], ['desktop', 'In-app notifications', 'Show alerts in the notification bell']]
  return <Card title="Notification preferences" subtitle="Personal preferences. Team delivery is configured under Integrations."><div className="col" style={{ gap: 0 }}>{rows.map(([k, t, d]) => <div key={k} className="row" style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}><div style={{ flex: 1 }}><div>{t}</div><div className="small muted">{d}</div></div><Toggle on={s.notif[k]} label={t} onChange={(v) => set(k, v)} /></div>)}</div></Card>
}

function Audit() {
  const audit = useStore((s) => s.audit)
  const [q, setQ] = useState('')
  const rows = audit.filter((a) => !q || (a.user + a.action + a.detail).toLowerCase().includes(q.toLowerCase()))
  return <Card title="Audit log" flush actions={<input className="input sm" style={{ width: 220 }} placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter audit log" />}>{!rows.length ? <Empty icon="list" title="No entries" /> : <DataTable rows={rows} columns={[{ key: 'ts', label: 'Time', render: (r) => <span className="muted">{fmtDateTime(r.ts, { year: 'numeric', second: '2-digit' })}</span> }, { key: 'user', label: 'User' }, { key: 'action', label: 'Action', render: (r) => <span className="chip mono">{r.action}</span> }, { key: 'detail', label: 'Details' }, { key: 'ip', label: 'IP', render: (r) => <span className="mono muted">{r.ip}</span> }]} />}</Card>
}

export default function Settings({ tab }) {
  const t = TABS.some(([id]) => id === tab) ? tab : 'profile'
  const View = { profile: Profile, organization: Organization, roles: Roles, tokens: Tokens, agent: Agent, thresholds: Thresholds, timezone: Timezone, notifications: Notifications, audit: Audit }[t]
  return (
    <>
      <PageHeader title="Settings" subtitle="Account, workspace and platform configuration" />
      <Tabs value={t} onChange={(v) => navigate('/settings/' + v)} tabs={TABS.map(([id, label, icon]) => ({ id, label, icon }))} />
      <View />
    </>
  )
}
