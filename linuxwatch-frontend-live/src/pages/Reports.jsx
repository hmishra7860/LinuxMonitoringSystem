import { useState } from 'react'
import { Icon } from '../lib/icons.jsx'
import { Banner, Button, Card, DataTable, Empty, ErrorState, Loading, PageHeader, Pagination } from '../components/ui.jsx'
import { Field, Input } from '../components/forms.jsx'
import { api, toast } from '../api/client.js'
import { downloadBlob } from '../lib/utils.js'
import { buildPdf } from '../lib/pdf.js'
import { useStore } from '../api/store.js'

const REPORTS = [
  ['availability', 'Server availability', 'activity', 'Uptime and downtime per server'], ['cpu', 'CPU utilization', 'cpu', 'Average, P95 and peak CPU'], ['memory', 'RAM utilization', 'memory', 'Average, P95 and peak memory'],
  ['disk', 'Disk capacity', 'disk', 'Capacity, usage and time-to-full'], ['alerts', 'Alert summary', 'bell', 'Alert counts by server and severity'], ['services', 'Service availability', 'box', 'Monitored service uptime'], ['incidents', 'Historical incidents', 'file', 'Full incident timeline'],
]
const dstr = (ts) => new Date(ts).toISOString().slice(0, 10)

export default function Reports() {
  const [type, setType] = useState('availability')
  const [from, setFrom] = useState(dstr(Date.now() - 7 * 864e5))
  const [to, setTo] = useState(dstr(Date.now()))
  const [state, setState] = useState({ status: 'idle' })
  const [page, setPage] = useState(1)
  const servers = useStore((s) => s.servers)
  const err = !from || !to ? 'Choose a start and end date.' : new Date(from) > new Date(to) ? 'The start date must be before the end date.' : new Date(to) > new Date() ? 'The end date cannot be in the future.' : ''
  const run = async () => {
    if (err) return
    setState({ status: 'loading' }); setPage(1)
    try { setState({ status: 'ready', data: await api.runReport(type, new Date(from + 'T00:00:00').getTime(), new Date(to + 'T23:59:59').getTime()) }) } catch (e) { setState({ status: 'error', message: e.message }) }
  }
  const d = state.data
  const csv = () => {
    const esc = (v) => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
    downloadBlob(`linuxwatch-${type}-${from}_${to}.csv`, 'text/csv;charset=utf-8', [d.columns.map((c) => esc(c[1])).join(','), ...d.rows.map((r) => d.columns.map((c) => esc(r[c[0]])).join(','))].join('\n'))
    toast('success', 'CSV downloaded')
  }
  const pdf = () => { downloadBlob(`linuxwatch-${type}-${from}_${to}.pdf`, 'application/pdf', buildPdf({ title: d.title, subtitle: `Period ${from} to ${to} - ${d.rows.length} rows`, columns: d.columns, rows: d.rows, summary: d.summary })); toast('success', 'PDF downloaded') }
  return (
    <>
      <PageHeader title="Reports" subtitle="Generate and export infrastructure reports" />
      <div className="grid g-main" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,2.4fr)', alignItems: 'start' }}>
        <Card title="Report type" flush>
          {REPORTS.map(([id, label, icon, sub]) => (
            <button key={id} className={'nav-item' + (type === id ? ' active' : '')} style={{ borderRadius: 0, padding: '11px 16px' }} onClick={() => { setType(id); setState({ status: 'idle' }) }}>
              <Icon name={icon} size={17} /><span><div>{label}</div><div className="small faint">{sub}</div></span>
            </button>
          ))}
        </Card>
        <div className="col" style={{ gap: 14, minWidth: 0 }}>
          <Card title="Parameters">
            <div className="row wrap" style={{ alignItems: 'flex-end' }}>
              <Field label="From"><Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label="To"><Input type="date" value={to} min={from || undefined} max={dstr(Date.now())} onChange={(e) => setTo(e.target.value)} /></Field>
              <Button variant="primary" icon="file" loading={state.status === 'loading'} disabled={!!err || !servers.length} onClick={run}>Generate report</Button>
            </div>
            {err && <div className="err-text" style={{ marginTop: 8 }}>{err}</div>}
            {!servers.length && <div className="hint" style={{ marginTop: 8 }}>Add servers to generate reports.</div>}
          </Card>
          {state.status === 'idle' && <Card><Empty icon="file" title="No report generated" text="Choose a report type and date range, then generate it. You can export it to CSV or PDF." /></Card>}
          {state.status === 'loading' && <Card><Loading rows={5} /></Card>}
          {state.status === 'error' && <Card><ErrorState message={state.message} onRetry={run} /></Card>}
          {state.status === 'ready' && (
            <Card title={d.title} subtitle={`${from} → ${to} · ${d.rows.length} rows`} flush actions={<><Button size="sm" icon="download" onClick={csv} disabled={!d.rows.length}>CSV</Button><Button size="sm" icon="download" onClick={pdf} disabled={!d.rows.length}>PDF</Button></>}>
              <div className="row wrap" style={{ gap: 24, padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>{d.summary.map(([k, v]) => <div key={k}><div className="faint small">{k}</div><div style={{ fontSize: 18, fontWeight: 650 }}>{v}</div></div>)}</div>
              {!d.rows.length ? <Empty icon="checkCircle" title="No data for this period" text="Nothing matched this report and date range." /> : <>
                <DataTable rows={d.rows.slice((page - 1) * 10, page * 10).map((r, i) => ({ ...r, __k: i }))} rowKey="__k" columns={d.columns.map(([key, label]) => ({ key, label }))} />
                <Pagination page={page} pageSize={10} total={d.rows.length} onPage={setPage} />
              </>}
            </Card>
          )}
        </div>
      </div>
    </>
  )
}
