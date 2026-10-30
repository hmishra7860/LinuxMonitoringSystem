import { useState } from 'react'
import { Icon } from '../lib/icons.jsx'
import { Link, navigate } from '../lib/router.jsx'
import { api, toast } from '../api/client.js'
import { Button, Banner } from '../components/ui.jsx'
import { Field, Input, PasswordInput, Checkbox } from '../components/forms.jsx'
import { isEmail, passwordIssues } from '../lib/utils.js'

function Shell({ title, subtitle, children }) {
  const feats = [['activity', 'Real-time CPU, memory, disk and network metrics'], ['bell', 'Threshold alerts with suppression and audit history'], ['plug', 'Email, Slack, Teams and webhook delivery'], ['shield', 'Agent tokens and secrets never shown after saving']]
  return (
    <div className="auth-shell">
      <div className="auth-side">
        <div className="brand" style={{ padding: 0, fontSize: 22 }}><div className="brand-mark" style={{ width: 36, height: 36 }}><Icon name="activity" size={20} /></div>LinuxWatch</div>
        <h1 style={{ fontSize: 30, lineHeight: 1.2, maxWidth: 420 }}>Know your Linux fleet is healthy — before your users do.</h1>
        <div className="col" style={{ gap: 14, maxWidth: 440 }}>{feats.map(([i, t]) => <div className="feature" key={t}><Icon name={i} className="ic" /><span>{t}</span></div>)}</div>
      </div>
      <div className="auth-main">
        <form className="auth-card" noValidate onSubmit={(e) => e.preventDefault()}>
          <div><h1 style={{ fontSize: 24 }}>{title}</h1><div className="muted" style={{ marginTop: 4 }}>{subtitle}</div></div>
          {children}
        </form>
      </div>
    </div>
  )
}

export function Login() {
  const [f, setF] = useState({ email: '', password: '', remember: true })
  const [errs, setErrs] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const submit = async () => {
    const er = {}
    if (!isEmail(f.email)) er.email = 'Enter a valid email address.'
    if (!f.password) er.password = 'Password is required.'
    setErrs(er); setError('')
    if (Object.keys(er).length) return
    setBusy(true)
    try { await api.login(f.email, f.password, f.remember); navigate('/overview') } catch (e) { setError(e.message); setBusy(false) }
  }
  return (
    <Shell title="Sign in" subtitle="Welcome back. Sign in to your workspace.">
      {error && <Banner tone="crit" icon="alert">{error}</Banner>}
      <Field label="Email address" error={errs.email}><Input type="email" value={f.email} onChange={set('email')} placeholder="you@company.com" autoComplete="email" error={errs.email} autoFocus /></Field>
      <Field label="Password" error={errs.password}><PasswordInput value={f.password} onChange={set('password')} placeholder="Your password" error={errs.password} /></Field>
      <div className="row"><Checkbox checked={f.remember} onChange={(v) => setF({ ...f, remember: v })}>Remember me</Checkbox><div className="spacer" /><Link to="/forgot">Forgot password?</Link></div>
      <Button variant="primary" type="submit" loading={busy} onClick={submit} style={{ padding: '9px 13px' }}>Sign in</Button>
      <div className="banner info small" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
        <div><b>Demo account</b> — demo@linuxwatch.io / Demo@1234</div>
        <Button size="sm" onClick={() => setF({ ...f, email: 'demo@linuxwatch.io', password: 'Demo@1234' })}>Fill demo credentials</Button>
      </div>
      <div className="muted" style={{ textAlign: 'center' }}>New to LinuxWatch? <Link to="/register">Create an account</Link></div>
    </Shell>
  )
}

export function Register() {
  const [f, setF] = useState({ name: '', company: '', email: '', password: '', confirm: '' })
  const [errs, setErrs] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const submit = async () => {
    const er = {}
    if (f.name.trim().length < 2) er.name = 'Enter your full name.'
    if (f.company.trim().length < 2) er.company = 'Enter your company name.'
    if (!isEmail(f.email)) er.email = 'Enter a valid email address.'
    const pw = passwordIssues(f.password)
    if (pw.length) er.password = 'Password needs ' + pw.join(', ') + '.'
    if (f.confirm !== f.password) er.confirm = 'Passwords do not match.'
    setErrs(er); setError('')
    if (Object.keys(er).length) return
    setBusy(true)
    try {
      await api.register(f)
      toast('success', 'Account created. Please sign in.')
      navigate('/login')
    } catch (e) { setError(e.message); setBusy(false) }
  }
  return (
    <Shell title="Create your account" subtitle="Start monitoring your Linux servers in minutes.">
      {error && <Banner tone="crit" icon="alert">{error}</Banner>}
      <Field label="Full name" error={errs.name}><Input value={f.name} onChange={set('name')} placeholder="Jane Doe" error={errs.name} autoFocus /></Field>
      <Field label="Company name" error={errs.company}><Input value={f.company} onChange={set('company')} placeholder="Acme Corp" error={errs.company} /></Field>
      <Field label="Work email" error={errs.email}><Input type="email" value={f.email} onChange={set('email')} placeholder="you@company.com" error={errs.email} /></Field>
      <Field label="Password" error={errs.password} hint="8+ characters with upper, lower case and a number."><PasswordInput value={f.password} onChange={set('password')} error={errs.password} /></Field>
      <Field label="Confirm password" error={errs.confirm}><PasswordInput value={f.confirm} onChange={set('confirm')} error={errs.confirm} /></Field>
      <Button variant="primary" type="submit" loading={busy} onClick={submit} style={{ padding: '9px 13px' }}>Create account</Button>
      <div className="muted" style={{ textAlign: 'center' }}>Already have an account? <Link to="/login">Sign in</Link></div>
    </Shell>
  )
}

export function Forgot() {
  const [email, setEmail] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const submit = async () => {
    if (!isEmail(email)) { setErr('Enter a valid email address.'); return }
    setErr(''); setBusy(true)
    await api.forgotPassword(email)
    setBusy(false); setSent(true)
  }
  return (
    <Shell title="Reset your password" subtitle="We'll email you a link to choose a new password.">
      {sent ? <Banner tone="ok" icon="checkCircle">If an account exists for <b>{email}</b>, a reset link is on its way.</Banner> : (
        <>
          <Field label="Email address" error={err}><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={err} placeholder="you@company.com" autoFocus /></Field>
          <Button variant="primary" type="submit" loading={busy} onClick={submit} style={{ padding: '9px 13px' }}>Send reset link</Button>
        </>
      )}
      <div style={{ textAlign: 'center' }}><Link to="/login">← Back to sign in</Link></div>
    </Shell>
  )
}
