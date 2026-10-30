import { useEffect, useState } from 'react'

function parse() {
  const raw = window.location.hash.replace(/^#/, '') || '/'
  const [p, q] = raw.split('?')
  const segs = p.split('/').filter(Boolean).map(decodeURIComponent)
  return { path: '/' + segs.join('/'), segs, query: Object.fromEntries(new URLSearchParams(q || '')) }
}
export function useRoute() {
  const [r, setR] = useState(parse)
  useEffect(() => {
    const f = () => setR(parse())
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])
  return r
}
export function navigate(to, { replace = false } = {}) {
  if (replace) window.location.replace('#' + to)
  else window.location.hash = to
}
export function Link({ to, children, ...p }) {
  return <a href={'#' + to} {...p}>{children}</a>
}
