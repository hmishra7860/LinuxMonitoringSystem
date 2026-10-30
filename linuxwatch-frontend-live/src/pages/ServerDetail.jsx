import { useEffect, useMemo, useState } from 'react'
import { Link, navigate } from '../lib/router.jsx'
import { useStore } from '../api/store.js'
import { api, toast } from '../api/client.js'
import { effectivePolicy, failedServices, moduleLabel, serverHealth, suppressionMatches } from '../lib/health.js'
import { useSeriesSet, useSnapshot } from '../data/metrics.js'
import { http } from '../api/http.js'
import { fmtDateTime, fmtGb, fmtMbps, fmtUptime, timeAgo, fmtDuration } from '../lib/utils.js'
import { Badge, Banner, Button, Card, Confirm, CopyField, DataTable, Empty, Pagination, PageHeader, Progress, SeverityBadge, StatCard, StatusBadge, Tabs } from '../components/ui.jsx'
import { Field, Input, NumberInput, Segmented, TimeRangePicker, defaultCustom } from '../components/forms.jsx'
import { COLORS, Legend, LineChart } from '../components/Charts.jsx'
import { SuppressModal } from './Suppressions.jsx'

function MetricChart({ title, server, metrics, thresholds, unit = '%', height = 240, subtitle, defaultRange = '1h' }) {
  const [range, setRange] = useState(defaultRange)
  const [custom, setCustom] = useState(defaultCustom)
  const res = useSeriesSet(metrics.map((m) => ({ id: m.key, path: `/servers/${server.id}/metrics`, params: { metric: m.key } })), range, custom)
  const data = metrics.map((m) => ({ ...m, labels: res.data[m.key]?.labels || [], values: res.data[m.key]?.values || [] }))
  return (
    <Card title={title} subtitle={subtitle} actions={<TimeRangePicker value={range} onChange={setRange} custom={custom} onCustom={setCustom} compact />}>
      <LineChart ariaLabel={title} unit={unit} height={height} thresholds={thresholds} labels={data[0].labels} series={data.map((d) => ({ name: d.name, color: d.color, values: d.values }))} />
      <div className="row wrap" style={{ marginTop: 6 }}>
        {metrics.length > 1 && <Legend items={metrics.map((m) => ({ label: m.name, color: m.color }))} />}
        <div className="spacer" />
        {thresholds && <Legend items={[{ label: `Warning ${thresholds.warn}${unit === '%' ? '%' : ' ' + unit}`, color: COLORS.amber }, { label: `Critical ${thresholds.crit}${unit === '%' ? '%' : ' ' + unit}`, color: COLORS.red }]} />}
      </div>
    </Card>
  )
}

const Kv = ({ k, children }) => <div><div className="k">{k}</div><div className="v">{children}</div></div>

function ThresholdEditor({ server, policy }) {
  const policies = useStore((s) => s.policies)
  const own = policies.find((p) => p.assignments.some((a) => a.type === 'server' && a.value === server.id))
  const [f, setF] = useState({ cpu: { ...policy.cpu }, memory: { ...policy.memory }, disk: { ...policy.disk }, network: { ...policy.network }, service: { ...policy.service } })
  const [errs, setErrs] = useState({})
  const [busy, setBusy] = useState(false)
  const set = (m, k, v) => setF((x) => ({ ...x, [m]: { ...x[m], [k]: v } }))
  const save = async () => {
    const e = {}
    for (const m of ['cpu', 'memory', 'disk']) {
      const t = f[m]
      if (t.warn === '' || t.crit === '' || t.warn < 1 || t.crit > 100) e[m] = 'Thresholds must be between 1 and 100.'
      else if (t.warn >= t.crit) e[m] = 'Warning must be lower than critical.'
      else if (!(t.duration >= 1)) e[m] = 'Evaluation duration must be at least 1 minute.'
    }
    if (!(f.network.inMbps > 0 && f.network.outMbps > 0)) e.network = 'Enter positive Mbps limits.'
    setErrs(e)
    if (Object.keys(e).length) return
    setBusy(true)
    try {
      const { notified } = await api.savePolicy({ ...(own || { name: `Server override – ${server.name}`, description: 'Created from the server page', isDefault: false, enabled: true, assignments: [{ type: 'server', value: server.id }] }), ...f })
      toast('success', `Thresholds saved for ${server.name}${notified ? ` — ${notified} new alert notification(s) sent` : ''}`)
    } catch (er) { toast('error', er.message) }
    setBusy(false)
  }
  const row = (m, label, unit = '%') => (
    <div key={m}>
      <div className="row wrap" style={{ gap: 12 }}>
        <b style={{ width: 80 }}>{label}</b>
        <Field label="Warning"><NumberInput width={110} value={f[m].warn} min={1} max={100} suffix="%" error={errs[m]} onChange={(v) => set(m, 'warn', v)} /></Field>
        <Field label="Critical"><NumberInput width={110} value={f[m].crit} min={1} max={100} suffix="%" error={errs[m]} onChange={(v) => set(m, 'crit', v)} /></Field>
        <Field label="Evaluate for"><NumberInput width={110} value={f[m].duration} min={1} max={1440} suffix="min" error={errs[m]} onChange={(v) => set(m, 'duration', v)} /></Field>
      </div>
      {errs[m] && <div className="err-text" style={{ marginTop: 4 }}>{errs[m]}</div>}
    </div>
  )
  return (
    <Card title="Thresholds for this server" subtitle={own ? 'Using a server-specific policy' : `Inherited from “${policy.name}” — saving creates a server-specific override`}>
      <div className="col" style={{ gap: 16 }}>
        {row('cpu', 'CPU')}{row('memory', 'Memory')}{row('disk', 'Disk')}
        <div className="row wrap" style={{ gap: 12 }}>
          <b style={{ width: 80 }}>Network</b>
          <Field label="Inbound limit"><NumberInput width={130} value={f.network.inMbps} min={1} max={100000} suffix="Mbps" error={errs.network} onChange={(v) => setF((x) => ({ ...x, network: { ...x.network, inMbps: v } }))} /></Field>
          <Field label="Outbound limit"><NumberInput width={130} value={f.network.outMbps} min={1} max={100000} suffix="Mbps" error={errs.network} onChange={(v) => setF((x) => ({ ...x, network: { ...x.network, outMbps: v } }))} /></Field>
        </div>
        {errs.network && <div className="err-text">{errs.network}</div>}
        <div className="row"><Button variant="primary" loading={busy} onClick={save}>Save thresholds</Button><span className="hint">Alerts are re-evaluated immediately.</span></div>
      </div>
    </Card>
  )
}

export default function ServerDetail({ id }) {
  const server = useStore((s) => s.servers.find((x) => x.id === id))
  const policies = useStore((s) => s.policies)
  const alerts = useStore((s) => s.alerts)
  const sups = useStore((s) => s.suppressions)
  const now = useStore((s) => s.now)
  const [tab, setTab] = useState('overview')
  const [suppress, setSuppress] = useState(false)
  const [regen, setRegen] = useState(false)
  const [newToken, setNewToken] = useState('')
  const [logLevel, setLogLevel] = useState('all')
  const [logQ, setLogQ] = useState('')
  const [logPage, setLogPage] = useState(1)

  const snap = useSnapshot(id)
  const procs = snap.processes
  const [logs, setLogs] = useState([])
  useEffect(() => {
    let off = false
    const load = () => http('GET', `/servers/${id}/logs?limit=500`).then((r) => { if (!off) setLogs(r.items) }).catch(() => {})
    load()
    const t = setInterval(load, 30000)
    return () => { off = true; clearInterval(t) }
  }, [id])
  if (!server) return <Empty icon="server" title="Server not found" text="It may have been deleted." action={<Button onClick={() => navigate('/infrastructure')}>Back to Infrastructure</Button>} />

  const pol = effectivePolicy(server, policies)
  const health = server.pending ? 'pending' : serverHealth(server, pol)
  const online = server.agentOnline
  const myAlerts = alerts.filter((a) => a.serverId === id)
  const open = myAlerts.filter((a) => a.status !== 'resolved')
  const activeSups = sups.filter((s) => suppressionMatches(s, server, 'all', now) || (!s.endedAt && (!s.expiresAt || s.expiresAt > now) && s.modules.some((m) => suppressionMatches({ ...s, modules: [m] }, server, m, now))))
  const fs = snap.filesystems, ifs = snap.interfaces, cores = snap.perCore, load = snap.loadAvg
  const ramUsed = (server.ramTotalGb * server.mem) / 100, swapUsed = (server.swapTotalGb * server.swapPct) / 100
  const diskUsed = (server.diskTotalGb * server.disk) / 100
  const errTotal = ifs.reduce((a, i) => a + i.errors, 0), dropTotal = ifs.reduce((a, i) => a + i.drops, 0)
  const tone = (v, t) => (!online ? 'off' : v >= t.crit ? 'crit' : v >= t.warn ? 'warn' : 'ok')
  const filteredLogs = logs.filter((l) => (logLevel === 'all' || l.level === logLevel) && (!logQ || (l.source + ' ' + l.message).toLowerCase().includes(logQ.toLowerCase())))
  const tabs = [
    { id: 'overview', label: 'Overview', icon: 'grid' }, { id: 'cpu', label: 'CPU', icon: 'cpu' }, { id: 'memory', label: 'Memory', icon: 'memory' }, { id: 'disk', label: 'Disk', icon: 'disk' },
    { id: 'network', label: 'Network', icon: 'activity' }, { id: 'processes', label: 'Processes', icon: 'list' }, { id: 'services', label: 'Services', icon: 'box', count: failedServices(server).length || undefined },
    { id: 'logs', label: 'Logs', icon: 'terminal' }, { id: 'alerts', label: 'Alerts & thresholds', icon: 'bell', count: open.length || undefined },
  ]
  const na = '—'
  const cpuT = { warn: pol.cpu.warn, crit: pol.cpu.crit }, memT = { warn: pol.memory.warn, crit: pol.memory.crit }, diskT = { warn: pol.disk.warn, crit: pol.disk.crit }

  return (
    <>
      <div><Link to="/infrastructure" className="small muted">← Infrastructure</Link></div>
      <PageHeader title={<span className="row" style={{ gap: 12 }}>{server.name}<StatusBadge status={health} /></span>} subtitle={`${server.client} · ${server.env} · ${server.region}`} actions={<><Button icon="pause" onClick={() => setSuppress(true)}>Suppress alerts</Button><Button icon="bell" onClick={() => setTab('alerts')}>Configure thresholds</Button></>} />
      {server.pending && <Banner tone="info" icon="clock">Waiting for the first heartbeat from this server. Install the agent using the token shown at registration (it can be regenerated in the server settings).</Banner>}
      {!online && !server.pending && <Banner tone="crit" icon="alert">Agent not reporting since <b>{fmtDateTime(server.lastHeartbeat)}</b> ({timeAgo(server.lastHeartbeat, now)}). Metrics shown are last-known values; check connectivity and the <span className="mono">linuxwatch-agent</span> service.</Banner>}
      {activeSups.length > 0 && <Banner tone="warn" icon="pause">Alerts are <b>suppressed</b> for this server ({activeSups.map((s) => s.modules.map(moduleLabel).join(', ')).join('; ')}). Metrics are still being collected.</Banner>}
      <Card><div className="kv">
        <Kv k="Hostname"><span className="mono">{server.hostname}</span></Kv><Kv k="IP address"><span className="mono">{server.ip}</span></Kv>
        <Kv k="Operating system">{server.os} {server.osVersion}</Kv><Kv k="Kernel"><span className="mono">{server.kernel}</span></Kv>
        <Kv k="Uptime">{online ? fmtUptime(server.uptimeSec) : na}</Kv>
        <Kv k="Agent connectivity">{server.pending ? <Badge tone="info" dot>Awaiting agent</Badge> : online ? <Badge tone="ok" dot>Connected · v{server.agentVersion}</Badge> : <Badge tone="off" dot>Disconnected</Badge>}</Kv>
        <Kv k="Last data received">{server.lastHeartbeat ? <>{fmtDateTime(server.lastHeartbeat, { second: '2-digit' })} <span className="muted">({timeAgo(server.lastHeartbeat, now)})</span></> : 'never'}</Kv>
        <Kv k="Overall health"><StatusBadge status={health} /></Kv>
        <Kv k="Tags"><div className="row wrap" style={{ gap: 4 }}>{server.tags.length ? server.tags.map((t) => <span key={t} className="chip">{t}</span>) : na}</div></Kv>
        <Kv k="Hardware">{server.cores} vCPU · {server.ramTotalGb} GB RAM · {server.diskTotalGb} GB disk</Kv>
      </div>{server.description && <div className="muted" style={{ marginTop: 12 }}>{server.description}</div>}</Card>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'overview' && (
        <>
          <div className="grid g4">
            <StatCard label="CPU" icon="cpu" value={online ? server.cpu.toFixed(1) + '%' : na} tone={tone(server.cpu, pol.cpu)} sub={`Warn ${pol.cpu.warn}% · Crit ${pol.cpu.crit}%`} />
            <StatCard label="Memory" icon="memory" value={online ? server.mem.toFixed(1) + '%' : na} tone={tone(server.mem, pol.memory)} sub={`Warn ${pol.memory.warn}% · Crit ${pol.memory.crit}%`} />
            <StatCard label="Disk" icon="disk" value={online ? server.disk.toFixed(1) + '%' : na} tone={tone(server.disk, pol.disk)} sub={`Warn ${pol.disk.warn}% · Crit ${pol.disk.crit}%`} />
            <StatCard label="Network" icon="activity" value={online ? fmtMbps(server.netIn + server.netOut) : na} sub={`↓ ${fmtMbps(server.netIn)} · ↑ ${fmtMbps(server.netOut)}`} />
          </div>
          <div className="grid g2">
            <MetricChart title="CPU utilization" server={server} metrics={[{ key: 'cpu', name: 'CPU', color: COLORS.blue }]} thresholds={cpuT} height={200} />
            <MetricChart title="Memory utilization" server={server} metrics={[{ key: 'memory', name: 'Memory', color: COLORS.purple }]} thresholds={memT} height={200} />
            <MetricChart title="Disk utilization" server={server} metrics={[{ key: 'disk', name: 'Disk', color: COLORS.teal }]} thresholds={diskT} height={200} defaultRange="24h" />
            <MetricChart title="Network throughput" server={server} unit="Mbps" metrics={[{ key: 'netIn', name: 'Inbound', color: COLORS.green }, { key: 'netOut', name: 'Outbound', color: COLORS.amber }]} thresholds={{ warn: pol.network.inMbps * 0.8, crit: pol.network.inMbps }} height={200} />
          </div>
        </>
      )}

      {tab === 'cpu' && (
        <>
          <div className="grid g4">
            <StatCard label="CPU utilization" icon="cpu" value={online ? server.cpu.toFixed(1) + '%' : na} tone={tone(server.cpu, pol.cpu)} />
            <StatCard label="Load average (1m)" value={online ? load[0].toFixed(2) : na} sub={`${server.cores} cores`} />
            <StatCard label="Load average (5m)" value={online ? load[1].toFixed(2) : na} />
            <StatCard label="Load average (15m)" value={online ? load[2].toFixed(2) : na} />
          </div>
          <MetricChart title="Historical CPU utilization" server={server} metrics={[{ key: 'cpu', name: 'CPU', color: COLORS.blue }]} thresholds={cpuT} />
          <Card title="Per-core utilization" subtitle={`${server.cores} cores`}>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))' }}>
              {cores.map((c, i) => <div key={i}><div className="row small"><span className="muted">Core {i}</span><div className="spacer" /><b>{online ? c.toFixed(0) + '%' : na}</b></div><Progress value={online ? c : 0} warn={pol.cpu.warn} crit={pol.cpu.crit} /></div>)}
            </div>
          </Card>
        </>
      )}

      {tab === 'memory' && (
        <>
          <div className="grid g4">
            <StatCard label="Total RAM" icon="memory" value={fmtGb(server.ramTotalGb)} />
            <StatCard label="Used RAM" value={online ? fmtGb(ramUsed) : na} tone={tone(server.mem, pol.memory)} sub={online ? server.mem.toFixed(1) + '%' : ''} />
            <StatCard label="Available RAM" value={online ? fmtGb(server.ramTotalGb - ramUsed) : na} />
            <StatCard label="Swap used" value={online ? fmtGb(swapUsed) : na} sub={`of ${fmtGb(server.swapTotalGb)} (${server.swapPct.toFixed(0)}%)`} />
          </div>
          <MetricChart title="Memory utilization" server={server} metrics={[{ key: 'memory', name: 'Memory', color: COLORS.purple }]} thresholds={memT} />
          <MetricChart title="Swap usage" server={server} metrics={[{ key: 'swap', name: 'Swap', color: COLORS.pink }]} height={180} />
        </>
      )}

      {tab === 'disk' && (
        <>
          <div className="grid g4">
            <StatCard label="Total capacity" icon="disk" value={fmtGb(server.diskTotalGb)} />
            <StatCard label="Used" value={online ? fmtGb(diskUsed) : na} tone={tone(server.disk, pol.disk)} sub={online ? server.disk.toFixed(1) + '%' : ''} />
            <StatCard label="Free" value={online ? fmtGb(server.diskTotalGb - diskUsed) : na} />
            <StatCard label="Highest inode use" value={online ? Math.max(...fs.map((f) => f.inode)).toFixed(0) + '%' : na} />
          </div>
          <MetricChart title="Historical disk utilization" server={server} metrics={[{ key: 'disk', name: 'Disk', color: COLORS.teal }]} thresholds={diskT} defaultRange="7d" />
          <Card title="Filesystems" flush>
            <DataTable rows={fs} rowKey="mount" columns={[
              { key: 'mount', label: 'Mount', render: (r) => <b className="mono">{r.mount}</b> }, { key: 'device', label: 'Device', render: (r) => <span className="mono muted">{r.device}</span> }, { key: 'fs', label: 'Type' },
              { key: 'size', label: 'Size', num: true, render: (r) => fmtGb(r.size) }, { key: 'used', label: 'Used', num: true, render: (r) => fmtGb(r.used) }, { key: 'free', label: 'Free', num: true, render: (r) => fmtGb(r.size - r.used) },
              { key: 'pct', label: 'Usage', render: (r) => <div style={{ minWidth: 110 }}><div className="small">{r.pct.toFixed(0)}%</div><Progress value={r.pct} warn={pol.disk.warn} crit={pol.disk.crit} /></div> },
              { key: 'inode', label: 'Inodes', render: (r) => <div style={{ minWidth: 90 }}><div className="small">{r.inode.toFixed(0)}%</div><Progress value={r.inode} warn={80} crit={90} /></div> },
            ]} />
          </Card>
        </>
      )}

      {tab === 'network' && (
        <>
          <div className="grid g4">
            <StatCard label="Incoming traffic" icon="activity" value={online ? fmtMbps(server.netIn) : na} />
            <StatCard label="Outgoing traffic" value={online ? fmtMbps(server.netOut) : na} />
            <StatCard label="Total throughput" value={online ? fmtMbps(server.netIn + server.netOut) : na} />
            <StatCard label="Packet errors / drops" value={online ? `${errTotal} / ${dropTotal}` : na} tone={errTotal > pol.network.errors ? 'crit' : undefined} sub={`Threshold ${pol.network.errors} errors`} />
          </div>
          <MetricChart title="Network traffic" server={server} unit="Mbps" metrics={[{ key: 'netIn', name: 'Inbound', color: COLORS.green }, { key: 'netOut', name: 'Outbound', color: COLORS.amber }]} thresholds={{ warn: pol.network.inMbps * 0.8, crit: pol.network.inMbps }} />
          <Card title="Interfaces" flush>
            <DataTable rows={ifs} rowKey="name" columns={[
              { key: 'name', label: 'Interface', render: (r) => <b className="mono">{r.name}</b> }, { key: 'rx', label: 'RX', num: true, render: (r) => fmtMbps(r.rx) }, { key: 'tx', label: 'TX', num: true, render: (r) => fmtMbps(r.tx) },
              { key: 'rxPk', label: 'RX packets', num: true, render: (r) => Math.round(r.rxPk).toLocaleString() }, { key: 'txPk', label: 'TX packets', num: true, render: (r) => Math.round(r.txPk).toLocaleString() },
              { key: 'errors', label: 'Errors', num: true }, { key: 'drops', label: 'Dropped', num: true },
            ]} />
          </Card>
        </>
      )}

      {tab === 'processes' && (
        <div className="grid g2">
          {[['Top CPU-consuming processes', 'cpu'], ['Top memory-consuming processes', 'mem']].map(([t, k]) => (
            <Card key={k} title={t} flush>
              <DataTable rows={[...procs].sort((a, b) => b[k] - a[k]).slice(0, 8)} rowKey="pid" columns={[
                { key: 'pid', label: 'PID', render: (r) => <span className="mono">{r.pid}</span> }, { key: 'name', label: 'Process', render: (r) => <b>{r.name}</b> }, { key: 'user', label: 'User', render: (r) => <span className="muted">{r.user}</span> },
                { key: 'cpu', label: 'CPU %', num: true, render: (r) => r.cpu.toFixed(1) }, { key: 'mem', label: 'MEM %', num: true, render: (r) => r.mem.toFixed(1) },
              ]} empty={<Empty title="No process data" />} />
            </Card>
          ))}
        </div>
      )}

      {tab === 'services' && <ServicesTab server={server} online={online} />}

      {tab === 'logs' && (
        <Card flush title="System logs" subtitle="journalctl / syslog, collected by the agent" actions={<>
          <Segmented value={logLevel} onChange={(v) => { setLogLevel(v); setLogPage(1) }} options={[{ value: 'all', label: 'All' }, 'CRITICAL', 'ERROR', 'WARNING', 'INFO']} />
          <input className="input sm" style={{ width: 200 }} placeholder="Search logs…" value={logQ} onChange={(e) => { setLogQ(e.target.value); setLogPage(1) }} aria-label="Search logs" />
        </>}>
          {!filteredLogs.length ? <Empty icon="search" title="No log lines match" text="Adjust the level filter or search text." /> : filteredLogs.slice((logPage - 1) * 15, logPage * 15).map((l) => (
            <div key={l.id} className="logline"><span className="muted">{fmtDateTime(l.ts, { second: '2-digit' })}</span><span className={l.level === 'CRITICAL' || l.level === 'ERROR' ? 'tone-crit' : l.level === 'WARNING' ? 'tone-warn' : 'muted'}>{l.level}</span><span className="muted">{l.source}</span><span>{l.message}</span></div>
          ))}
          {filteredLogs.length > 0 && <Pagination page={logPage} pageSize={15} total={filteredLogs.length} onPage={setLogPage} />}
        </Card>
      )}

      {tab === 'alerts' && (
        <>
          <ThresholdEditor key={server.id + pol.id + JSON.stringify(pol.cpu)} server={server} policy={pol} />
          <Card title="Alerts for this server" flush actions={<Link to="/alerts" className="small">Alert Management →</Link>}>
            {!myAlerts.length ? <Empty icon="checkCircle" title="No alerts" text="This server has not triggered any alerts." /> : (
              <DataTable rows={[...myAlerts].sort((a, b) => b.triggeredAt - a.triggeredAt).slice(0, 8)} columns={[
                { key: 'id', label: 'ID', render: (r) => <span className="mono">{r.id}</span> }, { key: 'metric', label: 'Metric' }, { key: 'severity', label: 'Severity', render: (r) => <SeverityBadge severity={r.severity} /> },
                { key: 'value', label: 'Value', render: (r) => (typeof r.value === 'number' ? r.value.toFixed(0) : r.value) + r.unit }, { key: 'threshold', label: 'Threshold', render: (r) => r.threshold + r.unit },
                { key: 'triggeredAt', label: 'Triggered', render: (r) => <span className="muted">{timeAgo(r.triggeredAt, now)}</span> }, { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              ]} />
            )}
          </Card>
          <Card title="Agent registration" subtitle="The token is never displayed after registration. Regenerating invalidates the old one.">
            {newToken ? <><Banner tone="warn" icon="lock">Copy this token now — it won't be shown again.</Banner><div style={{ height: 8 }} /><CopyField value={newToken} /></> : <div className="row wrap"><span className="mono muted">{server.tokenPrefix}••••••••••••••••</span><div className="spacer" /><Button icon="key" onClick={() => setRegen(true)}>Regenerate token</Button></div>}
          </Card>
        </>
      )}
      {suppress && <SuppressModal initial={{ scope: 'server', value: server.id }} onClose={() => setSuppress(false)} />}
      {regen && <Confirm danger title="Regenerate registration token?" confirmLabel="Regenerate" message="The agent using the current token will be disconnected until it is reconfigured with the new token." onCancel={() => setRegen(false)} onConfirm={async () => { setNewToken(await api.regenerateToken(id)); setRegen(false) }} />}
    </>
  )
}

function ServicesTab({ server, online }) {
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const update = async (services) => { setBusy(true); await api.updateServer(server.id, { services }); setBusy(false) }
  const add = async () => {
    const n = name.trim().toLowerCase().replace(/\.service$/, '')
    if (!/^[a-z0-9@:_.-]{2,40}$/.test(n)) return setErr('Enter a valid systemd unit name, e.g. mysql or haproxy.')
    if (server.services.some((s) => s.name === n)) return setErr('This service is already listed.')
    setErr(''); setName('')
    await update([...server.services, { name: n, unit: n + '.service', monitored: true, status: 'active', since: Date.now() }])
    toast('success', `Now monitoring ${n}`)
  }
  return (
    <>
      <Card title="Service monitoring" subtitle="Status from systemctl is-active" flush actions={<div className="row"><input className="input sm" style={{ width: 180 }} placeholder="Add unit, e.g. mysql" value={name} onChange={(e) => { setName(e.target.value); setErr('') }} onKeyDown={(e) => e.key === 'Enter' && add()} aria-label="Service unit name" /><Button size="sm" icon="plus" onClick={add} loading={busy}>Monitor</Button></div>}>
        {err && <div className="err-text" style={{ padding: '8px 16px' }}>{err}</div>}
        <DataTable rows={server.services} rowKey="name" columns={[
          { key: 'name', label: 'Service', render: (r) => <b>{r.name}</b> }, { key: 'unit', label: 'Unit', render: (r) => <span className="mono muted">{r.unit}</span> },
          { key: 'status', label: 'Status', render: (r) => <StatusBadge status={!online ? 'offline' : r.status === 'active' ? 'running' : r.status} /> },
          { key: 'since', label: 'Since', render: (r) => <span className="muted">{r.status === 'not-installed' || !online ? '—' : fmtDuration(Date.now() - r.since)}</span> },
          { key: 'monitored', label: 'Alerting', render: (r) => (r.monitored ? <Badge tone="info">Monitored</Badge> : <span className="faint">Not monitored</span>) },
          { key: 'a', label: '', render: (r) => <div className="row" style={{ justifyContent: 'flex-end' }}>{(r.status === 'failed' || r.status === 'inactive') && <Button size="sm" onClick={() => update(server.services.map((s) => (s.name === r.name ? { ...s, status: 'active', since: Date.now() } : s))).then(() => toast('success', `${r.name} restarted (demo)`))}>Restart</Button>}{r.status !== 'not-installed' && <Button size="sm" variant="ghost" onClick={() => update(server.services.map((s) => (s.name === r.name ? { ...s, monitored: !s.monitored } : s)))}>{r.monitored ? 'Stop monitoring' : 'Monitor'}</Button>}</div> },
        ]} />
      </Card>
    </>
  )
}
