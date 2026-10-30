import { useState } from 'react'
import { Icon } from '../lib/icons.jsx'
import { cx } from '../lib/utils.js'
import { RANGES } from '../data/metrics.js'

export function Field({ label, error, hint, children, className, required }) {
  return (
    <div className={cx('field', className)}>
      {label && <label>{label}{required && <span className="tone-crit"> *</span>}</label>}
      {children}
      {error ? <span className="err-text" role="alert">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  )
}
export function Input({ error, className, ...p }) { return <input className={cx('input', error && 'err', className)} aria-invalid={!!error} {...p} /> }
export function PasswordInput({ error, ...p }) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <input className={cx('input', error && 'err')} type={show ? 'text' : 'password'} style={{ paddingRight: 38 }} autoComplete="off" {...p} />
      <button type="button" className="btn btn-ghost icon-btn btn-sm" style={{ position: 'absolute', right: 4, top: 4 }} onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}><Icon name="eye" size={15} /></button>
    </div>
  )
}
export function Select({ error, options, className, children, ...p }) {
  return (
    <select className={cx('select', error && 'err', className)} {...p}>
      {children || options.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
    </select>
  )
}
export function Textarea({ error, ...p }) { return <textarea className={cx('textarea', error && 'err')} {...p} /> }
export function Toggle({ on, onChange, label }) { return <button type="button" role="switch" aria-checked={on} aria-label={label} className={cx('toggle', on && 'on')} onClick={() => onChange(!on)} /> }
export function Checkbox({ checked, onChange, children }) {
  return <label className="check"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{children}</label>
}
export function Segmented({ options, value, onChange }) {
  return <div className="seg" role="group">{options.map((o) => { const v = o.value ?? o; const l = o.label ?? o; return <button key={v} type="button" className={cx(value === v && 'on')} onClick={() => onChange(v)}>{l}</button> })}</div>
}
export function ChipsInput({ values, onChange, placeholder = 'Type and press Enter', validate, transform = (v) => v }) {
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const add = () => {
    const v = transform(text.trim())
    if (!v) return
    if (validate && !validate(v)) { setErr('Invalid value'); return }
    if (!values.includes(v)) onChange([...values, v])
    setText(''); setErr('')
  }
  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="chip-input">
        {values.map((v) => <span key={v} className="chip">{v}<button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}><Icon name="x" size={12} /></button></span>)}
        <input value={text} placeholder={values.length ? '' : placeholder} onChange={(e) => { setText(e.target.value); setErr('') }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add() } else if (e.key === 'Backspace' && !text && values.length) onChange(values.slice(0, -1)) }} onBlur={add} />
      </div>
      {err && <span className="err-text">{err}</span>}
    </div>
  )
}
export function NumberInput({ value, onChange, min = 0, max = 100, suffix, error, width, ...p }) {
  return (
    <div className="row" style={{ gap: 6, width }}>
      <input className={cx('input', error && 'err')} type="number" value={value} min={min} max={max} onChange={(e) => onChange(e.target.value === '' ? '' : +e.target.value)} {...p} />
      {suffix && <span className="muted small">{suffix}</span>}
    </div>
  )
}
const toLocal = (ts) => { const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60e3); return d.toISOString().slice(0, 16) }
export function TimeRangePicker({ value, onChange, custom, onCustom, compact, ranges }) {
  const list = ranges ? RANGES.filter((r) => ranges.includes(r.id)) : RANGES
  return (
    <div className="row wrap" style={{ gap: 6 }}>
      <select className={cx('select', 'sm')} style={{ width: 'auto' }} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Time range">
        {list.map((r) => <option key={r.id} value={r.id}>{compact ? r.short : r.label}</option>)}
      </select>
      {value === 'custom' && (
        <>
          <input className="input sm" style={{ width: 'auto' }} type="datetime-local" value={toLocal(custom.from)} max={toLocal(custom.to)} onChange={(e) => e.target.value && onCustom({ ...custom, from: new Date(e.target.value).getTime() })} aria-label="From" />
          <span className="muted">→</span>
          <input className="input sm" style={{ width: 'auto' }} type="datetime-local" value={toLocal(custom.to)} min={toLocal(custom.from)} onChange={(e) => e.target.value && onCustom({ ...custom, to: new Date(e.target.value).getTime() })} aria-label="To" />
        </>
      )}
    </div>
  )
}
export const defaultCustom = () => ({ from: Date.now() - 3 * 864e5, to: Date.now() })
