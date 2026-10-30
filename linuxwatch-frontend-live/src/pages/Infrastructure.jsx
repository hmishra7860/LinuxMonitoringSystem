import { Fragment, useEffect, useMemo, useState } from 'react'
import { navigate, useRoute } from '../lib/router.jsx'
import { useStore } from '../api/store.js'
import { api, toast } from '../api/client.js'
import { timeAgo, fmtUptime } from '../lib/utils.js'
import { Badge, Button, Card, Confirm, Empty, Loading, Menu, Modal, PageHeader, Pagination, Progress, StatusBadge } from '../components/ui.jsx'
import { Field, Input, Select } from '../components/forms.jsx'
import { effectivePolicy } from '../lib/health.js'
import { useHealth } from '../components/Layout.jsx'
import { ENVS, REGIONS } from '../data/constants.js'
import AddServerWizard, { ServerFields, useClients, validateServer } from './AddServerWizard.jsx'
import { Icon } from '../lib/icons.jsx'

function EditServer({ server, onClose }) {
  const servers = useStore((s) => s.servers)
  const [f, setF] = useState({ name: server.name, hostname: server.hostname, os: server.os, osVersion: server.osVersion, description: server.description, env: server.env, client: server.client, newClient: '', region: server.region, tags: server.tags, monitoring: server.monitoring })
  const [errs, setErrs] = useState({})
  const [busy, setBusy] = useState(false)
  const save = async () => {
    const e = { ...validateServer(f, servers, 'basic', server.id), ...validateServer(f, servers, 'group', server.id), ...validateServer(f, servers, 'monitor', server.id) }
    setErrs(e)
    if (Object.keys(e).length) return
    setBusy(true)
    await api.updateServer(server.id, { name: f.name.trim(), hostname: f.hostname.trim(), os: f.os, osVersion: f.osVersion, description: f.description, env: f.env, client: f.client === '__new__' ? f.newClient.trim() : f.client, region: f.region, tags: f.tags, monitoring: f.monitoring })
    toast('success', 'Server updated'); onClose()
  }
  return <Modal title={`Edit ${server.name}`} onClose={onClose} size="lg" footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save changes</Button></>}><ServerFields f={f} set={(p) => setF((x) => ({ ...x, ...p }))} errs={errs} section="all" /></Modal>
}

export const Meter = ({ v, warn, crit, off }) => off ? <span className="faint">—</span> : (
  <div style={{ minWidth: 86 }}><div className="small" style={{ marginBottom: 3 }}>{v.toFixed(0)}%</div><Progress value={v} warn={warn} crit={crit} /></div>
)

export default function Infrastructure() {
  const { query } = useRoute()
  const servers = useHealth()
  const policies = useStore((s) => s.policies)
  const now = useStore((s) => s.now)
  const clients = useClients()
  const [q, setQ] = useState('')
  const [fClient, setFClient] = useState('')
  const [fEnv, setFEnv] = useState('')
  const [fRegion, setFRegion] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fTag, setFTag] = useState('')
  const [group, setGroup] = useState('none')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [adding, setAdding] = useState(query.add === '1')
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [ready, setReady] = useState(false)
  useEffect(() => { const t = setTimeout(() => setReady(true), 300); return () => clearTimeout(t) }, [])
  useEffect(() => { if (query.add === '1') { setAdding(true); navigate('/infrastructure', { replace: true }) } }, [query.add])
  useEffect(() => setPage(1), [q, fClient, fEnv, fRegion, fStatus, fTag, group, pageSize])

  const tags = useMemo(() => [...new Set(servers.flatMap((s) => s.tags))].sort(), [servers])
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    let l = servers.filter((s) => (!fClient || s.client === fClient) && (!fEnv || s.env === fEnv) && (!fRegion || s.region === fRegion) && (!fStatus || s.health === fStatus) && (!fTag || s.tags.includes(fTag)) && (!t || [s.name, s.hostname, s.ip, s.os, s.client, ...s.tags].join(' ').toLowerCase().includes(t)))
    const key = { client: (s) => s.client, environment: (s) => s.env, region: (s) => s.region, tag: (s) => s.tags[0] || 'untagged' }[group]
    l = [...l].sort((a, b) => (key ? key(a).localeCompare(key(b)) : 0) || a.name.localeCompare(b.name))
    return { list: l, key }
  }, [servers, q, fClient, fEnv, fRegion, fStatus, fTag, group])
  const pageRows = filtered.list.slice((page - 1) * pageSize, page * pageSize)
  const clientStats = clients.map((c) => { const l = servers.filter((s) => s.client === c); return { name: c, n: l.length, crit: l.filter((s) => s.health === 'critical').length, warn: l.filter((s) => s.health === 'warning').length, off: l.filter((s) => s.health === 'offline').length } }).filter((c) => c.n)
  const anyFilter = q || fClient || fEnv || fRegion || fStatus || fTag
  const reset = () => { setQ(''); setFClient(''); setFEnv(''); setFRegion(''); setFStatus(''); setFTag('') }

  let lastGroup = null
  return (
    <>
      <PageHeader title="Infrastructure" subtitle={`${servers.length} Linux servers across ${clientStats.length} clients`} actions={<Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add server</Button>} />
      {clientStats.length > 0 && (
        <div className="grid g4">
          {clientStats.map((c) => (
            <button key={c.name} className={'card stat click' + (fClient === c.name ? ' sel' : '')} onClick={() => setFClient(fClient === c.name ? '' : c.name)} aria-pressed={fClient === c.name}>
              <span className="label"><Icon name="building" size={14} />{c.name}</span>
              <span className="value">{c.n} <span className="muted small" style={{ fontWeight: 400 }}>servers</span></span>
              <span className="row" style={{ gap: 6 }}>{c.crit > 0 && <Badge tone="crit">{c.crit} critical</Badge>}{c.warn > 0 && <Badge tone="warn">{c.warn} warning</Badge>}{c.off > 0 && <Badge tone="off">{c.off} offline</Badge>}{!c.crit && !c.warn && !c.off && <Badge tone="ok" dot>All healthy</Badge>}</span>
            </button>
          ))}
        </div>
      )}
      <Card flush>
        <div className="card-head">
          <div className="search" style={{ maxWidth: 280 }}><Icon name="search" className="ic" size={15} /><input className="input sm" style={{ paddingLeft: 34 }} placeholder="Search name, host, IP, tag…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search servers" /></div>
          <Select className="sm" style={{ width: 'auto' }} value={fEnv} onChange={(e) => setFEnv(e.target.value)} aria-label="Environment filter"><option value="">All environments</option>{ENVS.map((e) => <option key={e}>{e}</option>)}</Select>
          <Select className="sm" style={{ width: 'auto' }} value={fRegion} onChange={(e) => setFRegion(e.target.value)} aria-label="Region filter"><option value="">All regions</option>{REGIONS.map((e) => <option key={e}>{e}</option>)}</Select>
          <Select className="sm" style={{ width: 'auto' }} value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="Status filter"><option value="">All statuses</option>{['healthy', 'warning', 'critical', 'offline'].map((e) => <option key={e} value={e}>{e[0].toUpperCase() + e.slice(1)}</option>)}</Select>
          <Select className="sm" style={{ width: 'auto' }} value={fTag} onChange={(e) => setFTag(e.target.value)} aria-label="Tag filter"><option value="">All tags</option>{tags.map((e) => <option key={e}>{e}</option>)}</Select>
          <div className="spacer" />
          <span className="muted small">Group by</span>
          <Select className="sm" style={{ width: 'auto' }} value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Group by"><option value="none">None</option><option value="client">Client</option><option value="environment">Environment</option><option value="region">Region</option><option value="tag">Tag (first)</option></Select>
          {anyFilter && <Button size="sm" variant="ghost" onClick={reset}>Clear filters</Button>}
        </div>
        {!ready ? <Loading rows={6} /> : !servers.length ? (
          <Empty icon="server" title="No servers registered" text="Add your first Linux server and install the agent to start monitoring." action={<Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add server</Button>} />
        ) : !filtered.list.length ? (
          <Empty icon="search" title="No servers match" text="Try a different search or clear the filters." action={<Button onClick={reset}>Clear filters</Button>} />
        ) : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Server</th><th>IP address</th><th>Operating system</th><th>Agent</th><th>Last heartbeat</th><th>Uptime</th><th>CPU</th><th>RAM</th><th>Disk</th><th>Status</th><th /></tr></thead>
            <tbody>
              {pageRows.map((s) => {
                const gv = filtered.key ? filtered.key(s) : null
                const head = gv !== lastGroup && gv != null ? (lastGroup = gv, <tr key={'g' + gv} className="group"><td colSpan={11}>{group[0].toUpperCase() + group.slice(1)}: {gv} · {filtered.list.filter((x) => filtered.key(x) === gv).length}</td></tr>) : null
                const pol = effectivePolicy(s, policies)
                return (<Fragment key={s.id}>{head}
                  <tr className="click" onClick={() => navigate('/infrastructure/' + s.id)}>
                    <td><div style={{ fontWeight: 600 }}>{s.name}</div><div className="small muted">{s.hostname}</div><div className="row" style={{ gap: 4, marginTop: 3 }}><Badge>{s.env}</Badge>{s.tags.slice(0, 2).map((t) => <span key={t} className="chip">{t}</span>)}</div></td>
                    <td className="mono">{s.ip}</td><td>{s.os}<div className="small muted">{s.osVersion}</div></td>
                    <td className="mono">{s.agentVersion}</td><td className="muted">{s.pending ? 'awaiting agent' : timeAgo(s.lastHeartbeat, now)}</td><td>{s.agentOnline ? fmtUptime(s.uptimeSec) : '—'}</td>
                    <td><Meter v={s.cpu} warn={pol.cpu.warn} crit={pol.cpu.crit} off={!s.agentOnline} /></td><td><Meter v={s.mem} warn={pol.memory.warn} crit={pol.memory.crit} off={!s.agentOnline} /></td><td><Meter v={s.disk} warn={pol.disk.warn} crit={pol.disk.crit} off={!s.agentOnline} /></td>
                    <td>{s.pending ? <StatusBadge status="pending" /> : <StatusBadge status={s.health} />}</td>
                    <td onClick={(e) => e.stopPropagation()}><Menu items={[{ label: 'View metrics', icon: 'eye', onClick: () => navigate('/infrastructure/' + s.id) }, { label: 'Edit server', icon: 'edit', onClick: () => setEditing(s) }, { sep: true }, { label: 'Delete server', icon: 'trash', danger: true, onClick: () => setDeleting(s) }]} /></td>
                  </tr></Fragment>)
              })}
            </tbody>
          </table></div>
        )}
        {filtered.list.length > 0 && <Pagination page={page} pageSize={pageSize} total={filtered.list.length} onPage={setPage} onPageSize={setPageSize} />}
      </Card>
      {adding && <AddServerWizard onClose={() => setAdding(false)} />}
      {editing && <EditServer server={editing} onClose={() => setEditing(null)} />}
      {deleting && <Confirm danger title="Delete server?" confirmLabel="Delete server" message={<>This removes <b>{deleting.name}</b>, its alerts and its registration token. Historical metrics are discarded and the agent will stop being accepted.</>} onCancel={() => setDeleting(null)} onConfirm={async () => { await api.deleteServer(deleting.id); toast('success', `${deleting.name} deleted`); setDeleting(null) }} />}
    </>
  )
}
