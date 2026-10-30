import { useEffect, useMemo, useState } from 'react'
import { navigate } from '../lib/router.jsx'
import { useStore } from '../api/store.js'
import { api, toast } from '../api/client.js'
import { fmtDateTime, fmtDuration, fmtFull, timeAgo } from '../lib/utils.js'
import { Badge, Banner, Button, Card, Confirm, Empty, IconButton, Menu, Modal, PageHeader, Pagination, SeverityBadge, StatusBadge, Tabs } from '../components/ui.jsx'
import { Select } from '../components/forms.jsx'
import { MODULES, moduleLabel } from '../lib/health.js'
import { PoliciesTab } from './Policies.jsx'
import { SuppressionsTab, SuppressModal } from './Suppressions.jsx'

const SUBTABS = [['active', 'Active'], ['warning', 'Warning'], ['critical', 'Critical'], ['resolved', 'Resolved'], ['suppressed', 'Suppressed'], ['history', 'Alert history']]
const isOpen = (a) => a.status === 'active' || a.status === 'acknowledged'
const TIME = [['all', 'Any time'], ['1', 'Last hour'], ['6', 'Last 6 hours'], ['24', 'Last 24 hours'], ['168', 'Last 7 days']]

function AlertDetail({ alert, onClose, onSuppress, onUnsuppress }) {
  const now = useStore((s) => s.now)
  const unit = alert.unit
  const val = typeof alert.value === 'number' ? alert.value.toFixed(0) : alert.value
  const end = alert.resolvedAt || now
  return (
    <Modal title={`${alert.id} · ${alert.metric}`} onClose={onClose} footer={<>
      <Button onClick={() => { onClose(); navigate('/infrastructure/' + alert.serverId) }} icon="server">View server</Button>
      {alert.status === 'active' && <Button icon="check" onClick={async () => { await api.ackAlert(alert.id); toast('success', 'Alert acknowledged'); onClose() }}>Acknowledge</Button>}
      {alert.status === 'suppressed' ? <Button icon="bell" onClick={() => { onClose(); onUnsuppress(alert) }}>Unsuppress</Button> : alert.status !== 'resolved' && <Button icon="pause" onClick={() => { onClose(); onSuppress(alert) }}>Suppress</Button>}
      {alert.status !== 'resolved' && <Button variant="primary" icon="checkCircle" onClick={async () => { await api.resolveAlert(alert.id); toast('success', 'Alert resolved'); onClose() }}>Resolve</Button>}
    </>}>
      <div className="row"><SeverityBadge severity={alert.severity} /><StatusBadge status={alert.status} /></div>
      <div style={{ fontSize: 15 }}>{alert.metric} {alert.severity === 'critical' ? 'exceeded the critical' : 'exceeded the warning'} threshold of <b>{alert.threshold}{unit}</b> on <b>{alert.serverName}</b>.</div>
      <div className="kv">
        <div><div className="k">Server</div><div className="v">{alert.serverName}</div></div><div><div className="k">Client</div><div className="v">{alert.client}</div></div>
        <div><div className="k">Current value</div><div className="v">{val}{unit}</div></div><div><div className="k">{alert.severity === 'critical' ? 'Critical' : 'Warning'} threshold</div><div className="v">{alert.threshold}{unit}</div></div>
        <div><div className="k">Triggered</div><div className="v">{fmtFull(alert.triggeredAt)}</div></div><div><div className="k">Duration</div><div className="v">{fmtDuration(end - alert.triggeredAt)}{alert.resolvedAt ? '' : ' (ongoing)'}</div></div>
        {alert.ackBy && <div><div className="k">Acknowledged by</div><div className="v">{alert.ackBy}</div></div>}
        {alert.resolvedAt && <div><div className="k">Resolved</div><div className="v">{fmtFull(alert.resolvedAt)} by {alert.resolvedBy === 'auto' ? 'auto-resolve' : alert.resolvedBy}</div></div>}
      </div>
      {alert.simulated && <Banner icon="info">This is a simulated alert created from the Integrations page.</Banner>}
    </Modal>
  )
}

function AlertsTab() {
  const alerts = useStore((s) => s.alerts)
  const servers = useStore((s) => s.servers)
  const now = useStore((s) => s.now)
  const [sub, setSub] = useState('active')
  const [fSev, setFSev] = useState(''); const [fServer, setFServer] = useState(''); const [fMod, setFMod] = useState(''); const [fStatus, setFStatus] = useState(''); const [fTime, setFTime] = useState('all')
  const [page, setPage] = useState(1)
  const [sel, setSel] = useState([])
  const [detail, setDetail] = useState(null)
  const [suppressing, setSuppressing] = useState(null)
  const [unsup, setUnsup] = useState(null)
  const [busy, setBusy] = useState('')
  useEffect(() => { setPage(1); setSel([]) }, [sub, fSev, fServer, fMod, fStatus, fTime])
  const subFilter = { active: isOpen, warning: (a) => isOpen(a) && a.severity === 'warning', critical: (a) => isOpen(a) && a.severity === 'critical', resolved: (a) => a.status === 'resolved', suppressed: (a) => a.status === 'suppressed', history: () => true }
  const counts = Object.fromEntries(SUBTABS.map(([id]) => [id, alerts.filter(subFilter[id]).length]))
  const rows = useMemo(() => alerts.filter(subFilter[sub]).filter((a) => (!fSev || a.severity === fSev) && (!fServer || a.serverId === fServer) && (!fMod || a.module === fMod) && (!fStatus || a.status === fStatus) && (fTime === 'all' || a.triggeredAt >= now - +fTime * 3600e3)).sort((a, b) => b.triggeredAt - a.triggeredAt),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [alerts, sub, fSev, fServer, fMod, fStatus, fTime])
  const pageRows = rows.slice((page - 1) * 10, page * 10)
  const alertServers = [...new Map(alerts.map((a) => [a.serverId, a.serverName])).entries()]
  const anyFilter = fSev || fServer || fMod || fStatus || fTime !== 'all'
  const act = async (fn, msg) => { await fn(); toast('success', msg) }
  const bulk = async (action) => { setBusy(action); await api.bulkAlerts(sel, action); toast('success', `${sel.length} alert(s) ${action === 'ack' ? 'acknowledged' : 'resolved'}`); setSel([]); setBusy('') }
  const allOnPage = pageRows.length > 0 && pageRows.every((r) => sel.includes(r.id))
  const fmtVal = (a) => (typeof a.value === 'number' ? a.value.toFixed(0) : a.value) + a.unit

  return (
    <>
      <Tabs tabs={SUBTABS.map(([id, label]) => ({ id, label, count: counts[id] }))} value={sub} onChange={setSub} />
      <Card flush>
        <div className="card-head">
          <Select className="sm" style={{ width: 'auto' }} value={fSev} onChange={(e) => setFSev(e.target.value)} aria-label="Severity"><option value="">All severities</option><option value="critical">Critical</option><option value="warning">Warning</option></Select>
          <Select className="sm" style={{ width: 'auto', maxWidth: 190 }} value={fServer} onChange={(e) => setFServer(e.target.value)} aria-label="Server"><option value="">All servers</option>{alertServers.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</Select>
          <Select className="sm" style={{ width: 'auto' }} value={fMod} onChange={(e) => setFMod(e.target.value)} aria-label="Metric"><option value="">All metrics</option>{MODULES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select>
          <Select className="sm" style={{ width: 'auto' }} value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{['active', 'acknowledged', 'resolved', 'suppressed'].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</Select>
          <Select className="sm" style={{ width: 'auto' }} value={fTime} onChange={(e) => setFTime(e.target.value)} aria-label="Time">{TIME.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
          {anyFilter && <Button size="sm" variant="ghost" onClick={() => { setFSev(''); setFServer(''); setFMod(''); setFStatus(''); setFTime('all') }}>Clear</Button>}
          <div className="spacer" />
          {sel.length > 0 && <><span className="muted small">{sel.length} selected</span><Button size="sm" loading={busy === 'ack'} onClick={() => bulk('ack')}>Acknowledge</Button><Button size="sm" variant="primary" loading={busy === 'resolve'} onClick={() => bulk('resolve')}>Resolve</Button></>}
        </div>
        {!rows.length ? <Empty icon={alerts.length ? 'filter' : 'checkCircle'} title={alerts.length ? 'No alerts in this view' : 'No alerts yet'} text={alerts.length ? 'Nothing matches the current tab and filters.' : 'Alerts appear here when a metric crosses a configured threshold.'} /> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th style={{ width: 34 }}><input type="checkbox" aria-label="Select all on page" checked={allOnPage} onChange={(e) => setSel(e.target.checked ? [...new Set([...sel, ...pageRows.map((r) => r.id)])] : sel.filter((id) => !pageRows.some((r) => r.id === id)))} /></th><th>Alert</th><th>Server</th><th>Metric</th><th className="num">Current</th><th className="num">Threshold</th><th>Severity</th><th>Triggered</th><th>Duration</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>{pageRows.map((a) => (
              <tr key={a.id} className="click" onClick={() => setDetail(a)}>
                <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${a.id}`} checked={sel.includes(a.id)} onChange={(e) => setSel(e.target.checked ? [...sel, a.id] : sel.filter((x) => x !== a.id))} /></td>
                <td className="mono">{a.id}</td><td><b>{a.serverName}</b><div className="small muted">{a.client}</div></td><td>{a.metric}</td>
                <td className="num"><b>{fmtVal(a)}</b></td><td className="num muted">{a.threshold}{a.unit}</td><td><SeverityBadge severity={a.severity} /></td>
                <td className="muted">{fmtDateTime(a.triggeredAt)}</td><td>{fmtDuration((a.resolvedAt || now) - a.triggeredAt)}</td><td><StatusBadge status={a.status} /></td>
                <td onClick={(e) => e.stopPropagation()}><div className="row" style={{ gap: 2 }}>
                  {a.status === 'active' && <IconButton icon="check" label="Acknowledge" size="sm" onClick={() => act(() => api.ackAlert(a.id), `${a.id} acknowledged`)} />}
                  {a.status !== 'resolved' && <IconButton icon="checkCircle" label="Resolve" size="sm" onClick={() => act(() => api.resolveAlert(a.id), `${a.id} resolved`)} />}
                  <Menu items={[{ label: 'View server', icon: 'server', onClick: () => navigate('/infrastructure/' + a.serverId) }, { label: 'Alert details', icon: 'eye', onClick: () => setDetail(a) }, a.status === 'suppressed' ? { label: 'Unsuppress', icon: 'bell', onClick: () => setUnsup(a) } : a.status !== 'resolved' && { label: 'Suppress…', icon: 'pause', onClick: () => setSuppressing(a) }]} />
                </div></td>
              </tr>))}</tbody>
          </table></div>
        )}
        {rows.length > 0 && <Pagination page={page} pageSize={10} total={rows.length} onPage={setPage} />}
      </Card>
      {detail && <AlertDetail alert={alerts.find((a) => a.id === detail.id) || detail} onClose={() => setDetail(null)} onSuppress={setSuppressing} onUnsuppress={setUnsup} />}
      {suppressing && <SuppressModal initial={{ scope: 'server', value: suppressing.serverId, modules: [suppressing.module] }} onClose={() => setSuppressing(null)} />}
      {unsup && <Confirm title="Unsuppress alerts?" confirmLabel="Unsuppress" message={<>This ends every active suppression covering <b>{moduleLabel(unsup.module)}</b> on <b>{unsup.serverName}</b>, so alerts and notifications resume.</>} onCancel={() => setUnsup(null)} onConfirm={async () => { const n = await api.unsuppressAlert(unsup); toast('success', `${n} suppression(s) ended`); setUnsup(null) }} />}
    </>
  )
}

export default function Alerts({ tab }) {
  const alerts = useStore((s) => s.alerts)
  const open = alerts.filter(isOpen)
  const t = ['alerts', 'policies', 'suppressions'].includes(tab) ? tab : 'alerts'
  return (
    <>
      <PageHeader title="Alert Management" subtitle={`${open.filter((a) => a.severity === 'critical').length} critical · ${open.filter((a) => a.severity === 'warning').length} warning · ${alerts.filter((a) => a.status === 'suppressed').length} suppressed`} />
      <Tabs value={t} onChange={(v) => navigate('/alerts/' + (v === 'alerts' ? '' : v))} tabs={[{ id: 'alerts', label: 'Alerts', icon: 'bell' }, { id: 'policies', label: 'Alert Policies', icon: 'shield' }, { id: 'suppressions', label: 'Suppression', icon: 'pause' }]} />
      {t === 'alerts' && <AlertsTab />}
      {t === 'policies' && <PoliciesTab />}
      {t === 'suppressions' && <SuppressionsTab />}
    </>
  )
}
