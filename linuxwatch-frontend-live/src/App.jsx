import { useEffect } from 'react'
import { useRoute, navigate } from './lib/router.jsx'
import { useStore } from './api/store.js'
import { startRealtime } from './api/client.js'
import { Icon } from './lib/icons.jsx'
import { AppLayout } from './components/Layout.jsx'
import { Toasts, Empty, Button } from './components/ui.jsx'
import { Login, Register, Forgot } from './pages/Auth.jsx'
import Overview from './pages/Overview.jsx'
import Infrastructure from './pages/Infrastructure.jsx'
import ServerDetail from './pages/ServerDetail.jsx'
import Alerts from './pages/Alerts.jsx'
import Integrations from './pages/Integrations.jsx'
import Reports from './pages/Reports.jsx'
import Settings from './pages/Settings.jsx'

const PUBLIC = ['login', 'register', 'forgot']

export default function App() {
  const { segs } = useRoute()
  const session = useStore((s) => s.session)
  const booting = useStore((s) => s.booting)
  const page = segs[0] || ''
  useEffect(() => { if (session) return startRealtime(); return undefined }, [session])
  useEffect(() => {
    if (booting) return
    if (!session && !PUBLIC.includes(page)) navigate('/login', { replace: true })
    else if (session && (PUBLIC.includes(page) || page === '')) navigate('/overview', { replace: true })
  }, [session, page, booting])

  if (booting) return <div className="empty" style={{ height: '100%', justifyContent: 'center' }}><Icon name="loader" className="spin" size={28} /><span>Loading workspace…</span></div>
  let view
  if (!session) {
    view = page === 'register' ? <Register /> : page === 'forgot' ? <Forgot /> : <Login />
    return <>{view}<Toasts /></>
  }
  switch (page) {
    case 'overview': view = <Overview />; break
    case 'infrastructure': view = segs[1] ? <ServerDetail id={segs[1]} /> : <Infrastructure />; break
    case 'alerts': view = <Alerts tab={segs[1] || 'alerts'} />; break
    case 'integrations': view = <Integrations />; break
    case 'reports': view = <Reports />; break
    case 'settings': view = <Settings tab={segs[1] || 'profile'} />; break
    default: view = <Empty icon="info" title="Page not found" text="That page doesn't exist." action={<Button variant="primary" onClick={() => navigate('/overview')}>Go to Overview</Button>} />
  }
  return <><AppLayout>{view}</AppLayout><Toasts /></>
}
