import { useEffect, useMemo, useState } from 'react'
import { Link, navigate } from '../lib/router.jsx'
import { useStore } from '../api/store.js'
import { api } from '../api/client.js'
import { useSeriesSet } from '../data/metrics.js'
import { fmtDuration, timeAgo, fmtMbps } from '../lib/utils.js'
import { Banner, Button, Card, Empty, Loading, PageHeader, Progress, SeverityBadge, StatCard, StatusBadge } from '../components/ui.jsx'
import { Segmented, TimeRangePicker, defaultCustom } from '../components/forms.jsx'
import { COLORS, Donut, Legend, LineChart } from '../components/Charts.jsx'
import { useHealth } from '../components/Layout.jsx'

const FILTERS = [['all', 'All servers'], ['healthy', 'Healthy'], ['warning', 'Warning'], ['critical', 'Critical'], ['offline', 'Offline']]

export default function Overview() {
  const servers = useHealth()
  const alerts = useStore((s) => s.alerts)
  const policies = useStore((s) => s.policies)
  const now = useStore((s) => s.now)
  const [filter, setFilter] = useState('all')
  const [range, setRange] = useState('1h')
  const [custom, setCustom] = useState(defaultCustom)

  const counts = useMemo(() => ({ all: servers.length, healthy: servers.filter((s) => s.health === 'healthy').length, warning: servers.filter((s) => s.health === 'warning').length, critical: servers.filter((s) => s.health === 'critical').length, offline: servers.filter((s) => s.health === 'offline').length }), [servers])
  const filtered = useMemo(() => (filter === 'all' ? servers : servers.filter((s) => s.health === filter)), [servers, filter])
  const def = policies.find((p) => p.isDefault) || policies[0]
  const ids = filtered.map((s) => s.id).join(',')
  const empty = { labels: [], values: [] }
  const reqs = ['cpu', 'memory', 'disk', 'netIn', 'netOut'].map((m) => ({ id: m, path: '/metrics/fleet', params: { metric: m, server_ids: ids } }))
  const fleet = useSeriesSet(reqs, range, custom, filtered.length > 0)
  const ready = !fleet.loading
  const series = { cpu: fleet.data.cpu || empty, mem: fleet.data.memory || empty, disk: fleet.data.disk || empty, nin: fleet.data.netIn || empty, nout: fleet.data.netOut || empty }

  const open = alerts.filter((a) => a.status === 'active' || a.status === 'acknowledged')
  const activeCount = alerts.filter((a) => a.status === 'active').length
  const recent = [...alerts].filter((a) => a.status !== 'resolved').sort((a, b) => b.triggeredAt - a.triggeredAt).slice(0, 6)
  const recentServers = [...servers].filter((s) => s.lastHeartbeat).sort((a, b) => b.lastHeartbeat - a.lastHeartbeat).slice(0, 6)
  const resolved = alerts.filter((a) => a.status === 'resolved' && a.resolvedAt)
  const mttr = resolved.length ? resolved.reduce((a, x) => a + (x.resolvedAt - x.triggeredAt), 0) / resolved.length : 0
  const fleetAvail = servers.length ? servers.reduce((a, s) => a + s.availability, 0) / servers.length : 0
  const clientNames = [...new Set(servers.map((s) => s.client))]
  const byClient = clientNames.map((c) => { const l = servers.filter((s) => s.client === c); return { client: c, n: l.length, avail: l.length ? l.reduce((a, s) => a + s.availability, 0) / l.length : null } }).filter((x) => x.n)
  const clientsExtra = []
  const sev = [{ label: 'Critical', value: open.filter((a) => a.severity === 'critical').length, color: 'var(--crit)' }, { label: 'Warning', value: open.filter((a) => a.severity === 'warning').length, color: 'var(--warn)' }, { label: 'Suppressed', value: alerts.filter((a) => a.status === 'suppressed').length, color: '#7b8aa8' }]
  const donut = sev.map((s) => ({ ...s, color: { 'var(--crit)': COLORS.red, 'var(--warn)': COLORS.amber }[s.color] || s.color }))

  if (!servers.length) {
    return (<><PageHeader title="Overview" subtitle="Infrastructure health at a glance" /><Card><Empty icon="server" title="No servers yet" text="Register your first Linux server and install the agent to start collecting metrics." action={<div className="row"><Button variant="primary" icon="plus" onClick={() => navigate('/infrastructure?add=1')}>Add server</Button></div>} /></Card></>)
  }
  const chartCard = (title, sub, children, legend) => <Card title={title} subtitle={sub} actions={fleet.error ? <span className="small" style={{ color: 'var(--crit)' }}>{fleet.error}</span> : null}>{ready ? children : <Loading rows={3} />}{legend}</Card>
  const thr = (t) => ({ warn: t.warn, crit: t.crit })
  return (
    <>
      <PageHeader title="Overview" subtitle={`Infrastructure health across ${servers.length} Linux servers`} actions={<><TimeRangePicker value={range} onChange={setRange} custom={custom} onCustom={setCustom} /><Button icon="plus" variant="primary" onClick={() => navigate('/infrastructure?add=1')}>Add server</Button></>} />
      <div className="grid g6">
        <StatCard label="Total servers" value={counts.all} icon="server" onClick={() => setFilter('all')} selected={filter === 'all'} />
        <StatCard label="Healthy" value={counts.healthy} icon="checkCircle" tone="ok" onClick={() => setFilter('healthy')} selected={filter === 'healthy'} />
        <StatCard label="Warning" value={counts.warning} icon="alert" tone="warn" onClick={() => setFilter('warning')} selected={filter === 'warning'} />
        <StatCard label="Critical" value={counts.critical} icon="alert" tone="crit" onClick={() => setFilter('critical')} selected={filter === 'critical'} />
        <StatCard label="Offline" value={counts.offline} icon="pause" tone="off" onClick={() => setFilter('offline')} selected={filter === 'offline'} />
        <StatCard label="Active alerts" value={activeCount} icon="bell" tone={activeCount ? 'crit' : 'ok'} sub={`${open.length} open incl. acknowledged`} onClick={() => navigate('/alerts')} />
      </div>
      <div className="row wrap">
        <Segmented value={filter} onChange={setFilter} options={FILTERS.map(([v, l]) => ({ value: v, label: `${l} (${counts[v]})` }))} />
        {filter !== 'all' && <span className="muted small">Charts show the average of {filtered.length} {filter} server{filtered.length === 1 ? '' : 's'}</span>}
      </div>
      {!filtered.length ? <Card><Empty icon="filter" title={`No ${filter} servers`} text="Nothing matches this filter right now." action={<Button onClick={() => setFilter('all')}>Show all servers</Button>} /></Card> : (
        <div className="grid g2">
          {chartCard('CPU utilization', 'Fleet average · global default thresholds', <LineChart ariaLabel="Fleet CPU utilization" series={[{ name: 'Avg CPU', color: COLORS.blue, values: series.cpu.values }]} labels={series.cpu.labels} thresholds={thr(def.cpu)} />)}
          {chartCard('Memory utilization', 'Fleet average', <LineChart ariaLabel="Fleet memory utilization" series={[{ name: 'Avg memory', color: COLORS.purple, values: series.mem.values }]} labels={series.mem.labels} thresholds={thr(def.memory)} />)}
          {chartCard('Disk utilization', 'Fleet average', <LineChart ariaLabel="Fleet disk utilization" series={[{ name: 'Avg disk', color: COLORS.teal, values: series.disk.values }]} labels={series.disk.labels} thresholds={thr(def.disk)} />)}
          {chartCard('Network traffic', 'Average per server', <LineChart ariaLabel="Fleet network traffic" unit="Mbps" series={[{ name: 'Inbound', color: COLORS.green, values: series.nin.values }, { name: 'Outbound', color: COLORS.amber, values: series.nout.values }]} labels={series.nin.labels} />, <div style={{ marginTop: 8 }}><Legend items={[{ label: 'Inbound', color: COLORS.green }, { label: 'Outbound', color: COLORS.amber }]} /></div>)}
        </div>
      )}
      <div className="grid g-main">
        <Card title="Recent alerts" actions={<Link to="/alerts" className="small">View all →</Link>} flush>
          {!recent.length ? <Empty icon="checkCircle" title="No open alerts" text="Everything is within thresholds." /> : recent.map((a) => (
            <div key={a.id} className="row" style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
              <span className="sev-dot" style={{ background: a.severity === 'critical' ? 'var(--crit)' : 'var(--warn)' }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><b>{a.metric}</b> {typeof a.value === 'number' ? `${a.value.toFixed(0)}${a.unit}` : a.value} on <Link to={'/infrastructure/' + a.serverId}>{a.serverName}</Link></div>
                <div className="small muted">{a.id} · threshold {a.threshold}{a.unit} · {timeAgo(a.triggeredAt, now)}</div>
              </div>
              <StatusBadge status={a.status} />
            </div>
          ))}
        </Card>
        <Card title="Alert severity distribution">
          <div className="row" style={{ gap: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Donut data={donut} center={sev[0].value + sev[1].value} sub="open alerts" />
            <div className="col" style={{ gap: 10 }}>{sev.map((s, i) => <div key={s.label} className="row"><span className="sev-dot" style={{ background: donut[i].color }} /><span style={{ width: 90 }}>{s.label}</span><b>{s.value}</b></div>)}</div>
          </div>
        </Card>
      </div>
      <div className="grid g-main">
        <Card title="Recently monitored servers" actions={<Link to="/infrastructure" className="small">All servers →</Link>} flush>
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Server</th><th>Status</th><th className="num">CPU</th><th className="num">RAM</th><th className="num">Disk</th><th>Heartbeat</th></tr></thead>
            <tbody>{recentServers.map((s) => (
              <tr key={s.id} className="click" onClick={() => navigate('/infrastructure/' + s.id)}>
                <td><b>{s.name}</b><div className="small muted">{s.client}</div></td><td><StatusBadge status={s.health} /></td>
                <td className="num">{s.agentOnline ? s.cpu.toFixed(0) + '%' : '—'}</td><td className="num">{s.agentOnline ? s.mem.toFixed(0) + '%' : '—'}</td><td className="num">{s.agentOnline ? s.disk.toFixed(0) + '%' : '—'}</td>
                <td className="muted">{timeAgo(s.lastHeartbeat, now)}</td>
              </tr>))}</tbody></table></div>
        </Card>
        <Card title="Server availability" subtitle="Last 30 days">
          <div className="row" style={{ alignItems: 'baseline', gap: 10 }}><span style={{ fontSize: 28, fontWeight: 650 }} className={fleetAvail >= 99.5 ? 'tone-ok' : 'tone-warn'}>{fleetAvail.toFixed(2)}%</span><span className="muted">fleet availability</span></div>
          <div className="small muted" style={{ margin: '2px 0 12px' }}>Mean time to resolve: <b style={{ color: 'var(--text)' }}>{mttr ? fmtDuration(mttr) : '—'}</b></div>
          <div className="col" style={{ gap: 10 }}>
            {[...byClient, ...clientsExtra].map((c) => (
              <div key={c.client}><div className="row small"><span>{c.client}</span><span className="faint">{c.n} servers</span><div className="spacer" /><b>{c.avail.toFixed(2)}%</b></div><Progress value={(c.avail - 90) * 10} color={c.avail >= 99.5 ? 'var(--ok)' : c.avail >= 98 ? 'var(--warn)' : 'var(--crit)'} /></div>
            ))}
          </div>
        </Card>
      </div>
    </>
  )
}
