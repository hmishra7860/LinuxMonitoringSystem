import { useEffect, useRef, useState } from 'react'
import { Icon } from '../lib/icons.jsx'
import { cx, copyText } from '../lib/utils.js'
import { useStore } from '../api/store.js'

export function Button({ variant = 'secondary', size, icon, loading, children, className, ...p }) {
  return (
    <button className={cx('btn', variant !== 'secondary' && 'btn-' + variant, size === 'sm' && 'btn-sm', className)} disabled={loading || p.disabled} {...p}>
      {loading ? <Icon name="loader" className="spin" /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  )
}
export function IconButton({ icon, label, size = 'md', variant = 'ghost', ...p }) {
  return <button className={cx('btn icon-btn', 'btn-' + variant, size === 'sm' && 'btn-sm')} aria-label={label} title={label} {...p}><Icon name={icon} /></button>
}

const TONES = {
  healthy: ['ok', 'Healthy'], warning: ['warn', 'Warning'], critical: ['crit', 'Critical'], offline: ['off', 'Offline'], pending: ['info', 'Awaiting agent'],
  active: ['crit', 'Active'], acknowledged: ['info', 'Acknowledged'], resolved: ['ok', 'Resolved'], suppressed: ['off', 'Suppressed'],
  connected: ['ok', 'Connected'], failing: ['crit', 'Failing'], untested: ['neutral', 'Not tested'], delivered: ['ok', 'Delivered'], failed: ['crit', 'Failed'],
  OK: ['ok', 'OK'], Online: ['ok', 'Online'], Offline: ['off', 'Offline'], Warning: ['warn', 'Warning'], Critical: ['crit', 'Critical'],
  ended: ['neutral', 'Ended'], expired: ['neutral', 'Expired'], running: ['ok', 'Active'], inactive: ['crit', 'Inactive'], 'not-installed': ['neutral', 'Not installed'],
}
export function Badge({ tone = 'neutral', dot, children, className }) {
  return <span className={cx('badge', 'b-' + tone, className)}>{dot && <span className="dot" />}{children}</span>
}
export function StatusBadge({ status, label }) {
  const [tone, text] = TONES[status] || ['neutral', status]
  return <Badge tone={tone} dot>{label || text}</Badge>
}
export function SeverityBadge({ severity }) {
  return <Badge tone={severity === 'critical' ? 'crit' : severity === 'warning' ? 'warn' : 'info'}>{severity === 'critical' ? 'Critical' : severity === 'warning' ? 'Warning' : 'Info'}</Badge>
}

export function Card({ title, subtitle, actions, children, flush, className, style }) {
  return (
    <section className={cx('card', className)} style={style}>
      {(title || actions) && (
        <div className="card-head">
          <div><h3>{title}</h3>{subtitle && <div className="small muted">{subtitle}</div>}</div>
          <div className="spacer" />
          {actions}
        </div>
      )}
      <div className={cx('card-body', flush && 'flush')}>{children}</div>
    </section>
  )
}
export function StatCard({ label, value, icon, tone, sub, onClick, selected }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag className={cx('card stat', onClick && 'click', selected && 'sel')} onClick={onClick}>
      <span className="label">{icon && <Icon name={icon} size={14} className={tone && 'tone-' + tone} />}{label}</span>
      <span className={cx('value', tone && 'tone-' + tone)}>{value}</span>
      {sub && <span className="small muted">{sub}</span>}
    </Tag>
  )
}
export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{subtitle && <div className="sub">{subtitle}</div>}</div>
      <div className="spacer" />
      <div className="row wrap">{actions}</div>
    </div>
  )
}
export function Progress({ value, warn, crit, color }) {
  const c = color || (crit != null && value >= crit ? 'var(--crit)' : warn != null && value >= warn ? 'var(--warn)' : 'var(--ok)')
  return <div className="bar"><i style={{ width: Math.min(100, Math.max(0, value)) + '%', background: c }} /></div>
}
export function Empty({ icon = 'info', title, text, action }) {
  return <div className="empty"><div className="ic"><Icon name={icon} size={22} /></div><h3 style={{ color: 'var(--text)' }}>{title}</h3>{text && <div style={{ maxWidth: 420 }}>{text}</div>}{action}</div>
}
export function Loading({ rows = 4 }) {
  return <div className="col" style={{ padding: 16 }}>{Array.from({ length: rows }, (_, i) => <div key={i} className="skel" style={{ height: 22, width: `${100 - i * 9}%` }} />)}</div>
}
export function ErrorState({ message, onRetry }) {
  return <Empty icon="alert" title="Something went wrong" text={message} action={onRetry && <Button onClick={onRetry} icon="refresh">Retry</Button>} />
}
export function Banner({ tone = 'info', icon = 'info', children, onClose }) {
  return <div className={cx('banner', tone)}><Icon name={icon} />{<div style={{ flex: 1 }}>{children}</div>}{onClose && <IconButton icon="x" label="Dismiss" size="sm" onClick={onClose} />}</div>
}

export function Modal({ title, onClose, children, footer, size, dismissable = true }) {
  useEffect(() => {
    const f = (e) => { if (e.key === 'Escape' && dismissable) onClose?.() }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [onClose, dismissable])
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && dismissable) onClose?.() }}>
      <div className={cx('modal', size)} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2><div className="spacer" />{dismissable && <IconButton icon="x" label="Close" onClick={onClose} />}</div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}
export function Confirm({ title, message, confirmLabel = 'Confirm', danger, onConfirm, onCancel, children }) {
  const [busy, setBusy] = useState(false)
  const go = async () => { setBusy(true); try { await onConfirm() } finally { setBusy(false) } }
  return (
    <Modal title={title} onClose={onCancel} size="sm" footer={<><Button onClick={onCancel} disabled={busy}>Cancel</Button><Button variant={danger ? 'solid-danger' : 'primary'} loading={busy} onClick={go}>{confirmLabel}</Button></>}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        {danger && <Icon name="alert" className="tone-crit" size={20} style={{ marginTop: 2 }} />}
        <div className="col" style={{ gap: 10 }}><div>{message}</div>{children}</div>
      </div>
    </Modal>
  )
}
export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={cx('tab', value === t.id && 'on')} onClick={() => onChange(t.id)}>
          {t.icon && <Icon name={t.icon} size={15} />}{t.label}{t.count != null && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}
export function Pagination({ page, pageSize, total, onPage, onPageSize }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total ? (page - 1) * pageSize + 1 : 0
  return (
    <div className="pager">
      <span>{from}–{Math.min(total, page * pageSize)} of {total}</span>
      <div className="spacer" />
      {onPageSize && <select className="select sm" style={{ width: 'auto' }} value={pageSize} onChange={(e) => onPageSize(+e.target.value)} aria-label="Rows per page">{[10, 25, 50].map((n) => <option key={n} value={n}>{n} / page</option>)}</select>}
      <IconButton icon="chevL" label="Previous page" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} />
      <span>Page {page} / {pages}</span>
      <IconButton icon="chevR" label="Next page" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} />
    </div>
  )
}

export function useClickAway(ref, fn) {
  useEffect(() => {
    const f = (e) => { if (ref.current && !ref.current.contains(e.target)) fn() }
    document.addEventListener('mousedown', f)
    return () => document.removeEventListener('mousedown', f)
  }, [ref, fn])
}
export function Popover({ trigger, children, align = 'right', width }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useClickAway(ref, () => setOpen(false))
  return (
    <div className="pop-wrap" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{typeof trigger === 'function' ? trigger(open) : trigger}</div>
      {open && <div className={cx('popover', align === 'left' && 'left')} style={width ? { width } : undefined} onClick={(e) => { if (e.target.closest('[data-close]')) setOpen(false) }}>{typeof children === 'function' ? children(() => setOpen(false)) : children}</div>}
    </div>
  )
}
export function Menu({ items, label = 'Actions' }) {
  return (
    <Popover trigger={<IconButton icon="more" label={label} size="sm" />}>
      {(close) => items.filter(Boolean).map((it, i) => it.sep ? <div key={i} className="menu-sep" /> : (
        <button key={i} className={cx('menu-item', it.danger && 'danger')} onClick={(e) => { e.stopPropagation(); close(); it.onClick() }}><Icon name={it.icon || 'chevR'} size={15} />{it.label}</button>
      ))}
    </Popover>
  )
}
export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={cx('toast', t.type)}><Icon name={t.type === 'success' ? 'checkCircle' : t.type === 'error' ? 'alert' : 'info'} className={t.type === 'success' ? 'tone-ok' : t.type === 'error' ? 'tone-crit' : 'tone-info'} /><div>{t.message}</div></div>)}
    </div>
  )
}
export function CopyField({ value, label, multiline }) {
  const [done, setDone] = useState(false)
  return (
    <div className="col" style={{ gap: 4 }}>
      {label && <span className="lbl">{label}</span>}
      <div className="codebox" style={{ paddingRight: 44, whiteSpace: multiline ? 'pre' : 'pre-wrap', wordBreak: 'break-all' }}>
        {value}
        <button className="btn btn-ghost btn-sm icon-btn copy-btn" aria-label="Copy" onClick={async () => { await copyText(value); setDone(true); setTimeout(() => setDone(false), 1500) }}><Icon name={done ? 'check' : 'copy'} size={14} /></button>
      </div>
    </div>
  )
}
export function DataTable({ columns, rows, rowKey = 'id', onRowClick, empty }) {
  if (!rows.length) return empty || <Empty icon="list" title="No data" />
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr>{columns.map((c) => <th key={c.key} className={c.num ? 'num' : ''} style={c.width ? { width: c.width } : undefined}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[rowKey]} className={onRowClick ? 'click' : ''} onClick={onRowClick ? () => onRowClick(r) : undefined}>
              {columns.map((c) => <td key={c.key} className={c.num ? 'num' : ''}>{c.render ? c.render(r) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
