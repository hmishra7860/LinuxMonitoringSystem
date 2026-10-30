import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../lib/icons.jsx'
import { Link, navigate, useRoute } from '../lib/router.jsx'
import { cx, timeAgo, fmtDateTime } from '../lib/utils.js'
import { useStore } from '../api/store.js'
import { api } from '../api/client.js'
import { effectivePolicy, serverHealth } from '../lib/health.js'
import { Popover, StatusBadge, Badge, SeverityBadge } from './ui.jsx'

const NAV = [
  { id: 'overview', label: 'Overview', icon: 'grid', to: '/overview' },
  { id: 'infrastructure', label: 'Infrastructure', icon: 'server', to: '/infrastructure' },
  { id: 'alerts', label: 'Alert Management', icon: 'bell', to: '/alerts' },
  { id: 'integrations', label: 'Integrations', icon: 'plug', to: '/integrations' },
  { id: 'reports', label: 'Reports', icon: 'file', to: '/reports' },
  { id: 'settings', label: 'Settings', icon: 'settings', to: '/settings' },
]

export function useHealth() {
  const servers = useStore((s) => s.servers)
  const policies = useStore((s) => s.policies)
  return useMemo(() => servers.map((sv) => ({ ...sv, health: sv.pending ? 'offline' : serverHealth(sv, effectivePolicy(sv, policies)) })), [servers, policies])
}

function Sidebar({ open, onClose, current }) {
  const alerts = useStore((s) => s.alerts)
  const active = alerts.filter((a) => a.status === 'active').length
  return (
    <>
      <aside className={cx('sidebar', open && 'open')} aria-label="Main navigation">
        <div className="brand"><div className="brand-mark"><Icon name="activity" size={17} /></div>LinuxWatch</div>
        <div className="nav-label">Monitor</div>
        {NAV.map((n) => (
          <Link key={n.id} to={n.to} className={cx('nav-item', current === n.id && 'active')} onClick={onClose} aria-current={current === n.id ? 'page' : undefined}>
            <Icon name={n.icon} size={17} />{n.label}
            {n.id === 'alerts' && active > 0 && <span className="count">{active}</span>}
          </Link>
        ))}
        <div className="sidebar-foot">
          <div className="row"><span className="sev-dot pulse" style={{ background: 'var(--ok)' }} />Agents streaming (simulated)</div>
          <div style={{ marginTop: 4 }}>v0.1 · FastAPI backend not connected</div>
        </div>
      </aside>
      <div className={cx('scrim', open && 'open')} onClick={onClose} />
    </>
  )
}

function GlobalSearch() {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const servers = useStore((s) => s.servers)
  const alerts = useStore((s) => s.alerts)
  useEffect(() => {
    const f = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', f)
    return () => document.removeEventListener('mousedown', f)
  }, [])
  const t = q.trim().toLowerCase()
  const res = useMemo(() => {
    if (!t) return { s: [], a: [], p: [] }
    const pages = NAV.filter((n) => n.label.toLowerCase().includes(t))
    return {
      s: servers.filter((x) => [x.name, x.hostname, x.ip, x.client, x.region, ...x.tags].join(' ').toLowerCase().includes(t)).slice(0, 5),
      a: alerts.filter((x) => x.status !== 'resolved' && [x.id, x.serverName, x.metric].join(' ').toLowerCase().includes(t)).slice(0, 4), p: pages,
    }
  }, [t, servers, alerts])
  const go = (to) => { setOpen(false); setQ(''); navigate(to) }
  return (
    <div className="search" ref={ref}>
      <Icon name="search" className="ic" size={15} />
      <input className="input" placeholder="Search servers, alerts, pages…" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} aria-label="Global search" />
      {open && t && (
        <div className="popover left search-results" style={{ width: '100%', minWidth: 300 }}>
          {!res.s.length && !res.a.length && !res.p.length && <div className="muted" style={{ padding: 12 }}>No results for “{q}”</div>}
          {res.s.length > 0 && <div className="nav-label">Servers</div>}
          {res.s.map((s) => <button key={s.id} className="menu-item" onClick={() => go('/infrastructure/' + s.id)}><Icon name="server" size={15} /><span>{s.name}</span><span className="muted small">{s.client}</span></button>)}
          {res.a.length > 0 && <div className="nav-label">Alerts</div>}
          {res.a.map((a) => <button key={a.id} className="menu-item" onClick={() => go('/alerts')}><Icon name="alert" size={15} /><span>{a.id} · {a.metric}</span><span className="muted small">{a.serverName}</span></button>)}
          {res.p.length > 0 && <div className="nav-label">Pages</div>}
          {res.p.map((p) => <button key={p.id} className="menu-item" onClick={() => go(p.to)}><Icon name={p.icon} size={15} />{p.label}</button>)}
        </div>
      )}
    </div>
  )
}

function Bell() {
  const events = useStore((s) => s.events)
  const lastRead = useStore((s) => s.lastRead)
  const unread = events.filter((e) => e.ts > lastRead).length
  return (
    <Popover trigger={<button className="btn btn-ghost icon-btn" aria-label={`Notifications (${unread} unread)`} style={{ position: 'relative' }}><Icon name="bell" size={18} />{unread > 0 && <span className="bell-dot">{unread > 9 ? '9+' : unread}</span>}</button>} width={360}>
      {(close) => (
        <div>
          <div className="row" style={{ padding: '6px 10px' }}><b>Notifications</b><div className="spacer" /><button className="link-btn small" onClick={() => api.markNotificationsRead()}>Mark all read</button></div>
          <div className="menu-sep" />
          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {!events.length && <div className="muted" style={{ padding: 16, textAlign: 'center' }}>You're all caught up.</div>}
            {events.slice(0, 12).map((e) => (
              <button key={e.id} className="menu-item" style={{ alignItems: 'flex-start' }} onClick={() => { close(); api.markNotificationsRead(); navigate(e.serverId ? '/infrastructure/' + e.serverId : '/integrations') }}>
                <span className="sev-dot" style={{ marginTop: 7, background: e.severity === 'critical' ? 'var(--crit)' : e.severity === 'warning' ? 'var(--warn)' : 'var(--info)' }} />
                <span style={{ flex: 1 }}><div style={{ fontWeight: e.ts > lastRead ? 600 : 400 }}>{e.title}</div><div className="muted small">{e.body}</div><div className="faint small">{timeAgo(e.ts)}</div></span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Popover>
  )
}

function StatusPill() {
  const servers = useHealth()
  const crit = servers.filter((s) => s.health === 'critical').length
  const warn = servers.filter((s) => s.health === 'warning').length
  const off = servers.filter((s) => s.health === 'offline').length
  if (!servers.length) return <Badge tone="neutral" dot>No servers</Badge>
  const [tone, text] = crit ? ['crit', `${crit} critical`] : warn ? ['warn', `${warn} warning`] : off ? ['off', `${off} offline`] : ['ok', 'All systems healthy']
  return <Link to="/infrastructure" style={{ textDecoration: 'none' }} className="hide-m"><Badge tone={tone} dot className="pulse-dot">{text}</Badge></Link>
}

function WorkspaceSwitcher() {
  const workspaces = useStore((s) => s.workspaces)
  const id = useStore((s) => s.workspaceId)
  const cur = workspaces.find((w) => w.id === id) || workspaces[0]
  return (
    <Popover align="left" width={260} trigger={<button className="btn btn-sm" aria-label="Switch workspace"><Icon name="building" size={14} /><span className="hide-m">{cur?.name}</span><Icon name="chevD" size={13} /></button>}>
      {(close) => (
        <div>
          <div className="nav-label">Workspaces</div>
          {workspaces.map((w) => <button key={w.id} className="menu-item" onClick={() => { close(); if (w.id !== id) api.switchWorkspace(w.id) }}><Icon name={w.id === id ? 'check' : 'building'} size={15} /><span style={{ flex: 1 }}>{w.name}</span><span className="faint small">{w.plan}</span></button>)}
          <div className="menu-sep" />
          <button className="menu-item" onClick={() => { close(); navigate('/settings/organization') }}><Icon name="settings" size={15} />Manage workspaces</button>
        </div>
      )}
    </Popover>
  )
}

function UserMenu() {
  const user = useStore((s) => s.users.find((u) => u.id === s.session?.userId))
  if (!user) return null
  const initials = user.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
  return (
    <Popover trigger={<button className="btn btn-ghost" style={{ padding: 3 }} aria-label="User menu"><span className="avatar">{initials}</span></button>} width={230}>
      {(close) => (
        <div>
          <div style={{ padding: '8px 10px' }}><div style={{ fontWeight: 600 }}>{user.name}</div><div className="muted small">{user.email}</div><div className="faint small">{user.role}</div></div>
          <div className="menu-sep" />
          <button className="menu-item" onClick={() => { close(); navigate('/settings/profile') }}><Icon name="user" size={15} />Profile settings</button>
          <button className="menu-item" onClick={() => { close(); navigate('/settings/profile') }}><Icon name="lock" size={15} />Change password</button>
          <button className="menu-item" onClick={() => { close(); navigate('/settings/organization') }}><Icon name="building" size={15} />Workspace management</button>
          <div className="menu-sep" />
          <button className="menu-item danger" onClick={() => { close(); api.logout(); navigate('/login') }}><Icon name="logout" size={15} />Log out</button>
        </div>
      )}
    </Popover>
  )
}

export function AppLayout({ children }) {
  const { segs } = useRoute()
  const [open, setOpen] = useState(false)
  const mainRef = useRef(null)
  const current = segs[0] || 'overview'
  useEffect(() => { mainRef.current?.scrollTo?.(0, 0); setOpen(false) }, [segs.join('/')])
  return (
    <div className="app">
      <Sidebar open={open} onClose={() => setOpen(false)} current={current} />
      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost icon-btn hamburger" onClick={() => setOpen(true)} aria-label="Open navigation"><Icon name="menu" size={18} /></button>
          <WorkspaceSwitcher />
          <GlobalSearch />
          <div className="spacer" />
          <StatusPill />
          <Bell />
          <UserMenu />
        </header>
        <main className="content" ref={mainRef}><div className="page">{children}</div></main>
      </div>
    </div>
  )
}
