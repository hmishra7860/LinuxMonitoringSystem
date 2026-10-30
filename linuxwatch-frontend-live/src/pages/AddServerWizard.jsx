import { useMemo, useState } from 'react'
import { Icon } from '../lib/icons.jsx'
import { Banner, Button, CopyField, Modal, Tabs } from '../components/ui.jsx'
import { ChipsInput, Field, Input, Select, Textarea, Toggle, Segmented } from '../components/forms.jsx'
import { api, toast } from '../api/client.js'
import { ENVS, OS_LIST, REGIONS } from '../data/constants.js'
import { API_URL } from '../api/http.js'
import { useStore } from '../api/store.js'
import { isHostOrIp, cx } from '../lib/utils.js'
import { navigate } from '../lib/router.jsx'

export const emptyServer = () => ({ name: '', hostname: '', os: 'Ubuntu', osVersion: '22.04 LTS', description: '', env: 'Production', client: '__new__', newClient: '', region: REGIONS[0], tags: [], monitoring: { interval: 30, modules: { cpu: true, memory: true, disk: true, network: true, processes: true, services: true, logs: true } } })
export const MODULE_LABELS = { cpu: 'CPU', memory: 'Memory', disk: 'Disk', network: 'Network', processes: 'Processes', services: 'Services (systemctl)', logs: 'System logs (journalctl)' }

export function useClients() {
  const servers = useStore((s) => s.servers)
  return useMemo(() => [...new Set(servers.map((s) => s.client))], [servers])
}
export function validateServer(f, servers, section, editingId) {
  const e = {}
  if (section !== 'group' && section !== 'monitor') {
    if (f.name.trim().length < 3) e.name = 'Enter a display name (min. 3 characters).'
    else if (!/^[a-zA-Z0-9][a-zA-Z0-9._ -]*$/.test(f.name.trim())) e.name = 'Use letters, numbers, dots, dashes and spaces only.'
    else if (servers.some((s) => s.id !== editingId && s.name.toLowerCase() === f.name.trim().toLowerCase())) e.name = 'A server with this name already exists.'
    if (!f.hostname.trim()) e.hostname = 'Hostname or IP address is required.'
    else if (!isHostOrIp(f.hostname)) e.hostname = 'Enter a valid hostname or IPv4 address.'
  }
  if (section !== 'basic' && section !== 'monitor') {
    if (f.client === '__new__' && f.newClient.trim().length < 2) e.newClient = 'Enter the client name.'
    if (!f.env) e.env = 'Choose an environment.'
  }
  if (section === 'monitor' && !Object.values(f.monitoring.modules).some(Boolean)) e.modules = 'Enable at least one monitoring module.'
  return e
}

export function ServerFields({ f, set, errs, section = 'all' }) {
  const clients = useClients()
  const osVersions = (OS_LIST.find(([n]) => n === f.os) || [null, []])[1]
  const show = (k) => section === 'all' || section === k
  return (
    <>
      {show('basic') && (
        <div className="form-grid">
          <Field label="Server display name" required error={errs.name} hint="Shown across dashboards, e.g. linux-prod-01"><Input value={f.name} onChange={(e) => set({ name: e.target.value })} error={errs.name} placeholder="linux-prod-05" autoFocus /></Field>
          <Field label="Hostname or IP address" required error={errs.hostname}><Input value={f.hostname} onChange={(e) => set({ hostname: e.target.value })} error={errs.hostname} placeholder="prod-05.acme.internal or 10.0.4.25" /></Field>
          <Field label="Operating system"><Select value={f.os} onChange={(e) => set({ os: e.target.value, osVersion: (OS_LIST.find(([n]) => n === e.target.value)?.[1] || [''])[0] })} options={[...OS_LIST.map(([n]) => n), 'Other Linux']} /></Field>
          <Field label="OS version"><Select value={f.osVersion} onChange={(e) => set({ osVersion: e.target.value })} options={osVersions.length ? osVersions : ['Unknown']} /></Field>
          <Field className="full" label="Description"><Textarea value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="What does this server do?" maxLength={240} /></Field>
        </div>
      )}
      {show('group') && (
        <div className="form-grid">
          <Field label="Environment" required error={errs.env}><Select value={f.env} onChange={(e) => set({ env: e.target.value })} options={ENVS} /></Field>
          <Field label="Region"><Select value={f.region} onChange={(e) => set({ region: e.target.value })} options={REGIONS} /></Field>
          <Field label="Client / group" required error={errs.newClient}>
            <Select value={f.client} onChange={(e) => set({ client: e.target.value })}>{clients.map((c) => <option key={c}>{c}</option>)}<option value="__new__">+ New client…</option></Select>
          </Field>
          {f.client === '__new__' && <Field label="New client name" required error={errs.newClient}><Input value={f.newClient} onChange={(e) => set({ newClient: e.target.value })} error={errs.newClient} placeholder="Client company name" /></Field>}
          <Field className="full" label="Custom tags" hint="Press Enter to add. Tags are used for grouping and policy assignment."><ChipsInput values={f.tags} onChange={(tags) => set({ tags })} transform={(v) => v.toLowerCase()} validate={(v) => /^[a-z0-9:_-]{1,24}$/.test(v)} placeholder="web, db, k8s-node…" /></Field>
        </div>
      )}
      {show('monitor') && (
        <div className="col" style={{ gap: 12 }}>
          <Field label="Collection interval"><Segmented value={f.monitoring.interval} onChange={(v) => set({ monitoring: { ...f.monitoring, interval: v } })} options={[{ value: 15, label: '15 s' }, { value: 30, label: '30 s' }, { value: 60, label: '60 s' }, { value: 300, label: '5 min' }]} /></Field>
          <div className="lbl">Metrics to collect</div>
          {Object.entries(MODULE_LABELS).map(([k, l]) => (
            <div key={k} className="row" style={{ padding: '4px 0' }}><span>{l}</span><div className="spacer" /><Toggle on={f.monitoring.modules[k]} label={l} onChange={(v) => set({ monitoring: { ...f.monitoring, modules: { ...f.monitoring.modules, [k]: v } } })} /></div>
          ))}
          {errs.modules && <span className="err-text">{errs.modules}</span>}
          <div className="hint">Alert thresholds are inherited from the matching alert policy and can be changed later under Alert Management → Alert Policies.</div>
        </div>
      )}
    </>
  )
}

const STEPS = ['Server details', 'Grouping', 'Monitoring', 'Install agent']

export default function AddServerWizard({ onClose }) {
  const servers = useStore((s) => s.servers)
  const [step, setStep] = useState(0)
  const [f, setF] = useState(emptyServer)
  const [errs, setErrs] = useState({})
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [itab, setItab] = useState('script')
  const [connected, setConnected] = useState(false)
  const server = useStore((s) => (result ? s.servers.find((x) => x.id === result.server.id) : null))
  const set = (p) => setF((x) => ({ ...x, ...p }))
  const section = ['basic', 'group', 'monitor'][step]

  const next = async () => {
    const e = validateServer(f, servers, section)
    setErrs(e)
    if (Object.keys(e).length) return
    if (step < 2) return setStep(step + 1)
    setBusy(true)
    try {
      const res = await api.createServer({ ...f, client: f.client === '__new__' ? f.newClient.trim() : f.client })
      setResult(res); setStep(3)
    } catch (er) { toast('error', er.message) }
    setBusy(false)
  }
  const endpoint = API_URL
  const token = result?.token || ''
  const script = `curl -fsSL ${endpoint}/agent/install.sh | sudo LW_TOKEN=${token} LW_ENDPOINT=${endpoint} bash`
  const manual = `# 1. Install the agent (Python 3.9+)\nsudo pip install psutil requests\ncurl -fsSL ${endpoint}/agent/lw_agent.py -o /opt/linuxwatch/lw_agent.py\n\n# 2. Configure (see agent.ini.example in the backend)\nsudo tee /etc/linuxwatch/agent.ini >/dev/null <<EOF\n[agent]\nendpoint = ${endpoint}\ntoken = ${token}\nEOF\n\n# 3. Run it (the quick-install script sets up systemd for you)\nsudo python3 /opt/linuxwatch/lw_agent.py --config /etc/linuxwatch/agent.ini`

  return (
    <Modal title="Add Linux server" onClose={onClose} size="lg" dismissable={!busy && step < 3}
      footer={step < 3 ? <>
        {step > 0 && <Button onClick={() => setStep(step - 1)} disabled={busy}>Back</Button>}
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={next}>{step === 2 ? 'Register server' : 'Continue'}</Button>
      </> : <Button variant="primary" onClick={() => { onClose(); navigate('/infrastructure/' + result.server.id) }}>Open server page</Button>}>
      <div className="steps" aria-label="Progress">
        {STEPS.map((s, i) => (
          <div key={s} className="row" style={{ flex: i < STEPS.length - 1 ? 1 : 'none' }}>
            <div className={cx('step-dot', i === step && 'on', i < step && 'done')}><b>{i < step ? <Icon name="check" size={12} /> : i + 1}</b><span className="hide-m">{s}</span></div>
            {i < STEPS.length - 1 && <div className="step-line" />}
          </div>
        ))}
      </div>
      {step < 3 && <ServerFields f={f} set={set} errs={errs} section={section} />}
      {step === 3 && result && (
        <>
          <Banner tone="ok" icon="checkCircle"><b>{result.server.name}</b> is registered. Install the agent on the server to start streaming metrics.</Banner>
          <Banner tone="warn" icon="lock">This registration token is shown <b>only once</b>. Copy it now — it is never displayed in server listings and can only be regenerated.</Banner>
          <CopyField label="Registration token" value={token} />
          <Tabs value={itab} onChange={setItab} tabs={[{ id: 'script', label: 'Quick install', icon: 'terminal' }, { id: 'manual', label: 'Manual / systemd', icon: 'list' }]} />
          <CopyField multiline value={itab === 'script' ? script : manual} />
          <div className="hint">The agent uses psutil, systemctl and journalctl and pushes metrics to your LinuxWatch API with this token. The server appears as online after its first heartbeat.</div>
          <div className="row wrap">
            {connected || server?.agentOnline ? <Banner tone="ok" icon="checkCircle">First heartbeat received — agent connected.</Banner> : (
              <><span className="muted">Status: <b>Awaiting first heartbeat…</b></span><div className="spacer" />
                </>
            )}
          </div>
        </>
      )}
    </Modal>
  )
}
