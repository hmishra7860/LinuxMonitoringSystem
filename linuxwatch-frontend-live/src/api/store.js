import { useSyncExternalStore } from 'react'

let state = {}
const subs = new Set()
export const getState = () => state
export const subscribe = (f) => { subs.add(f); return () => subs.delete(f) }
export function setState(patch) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
  subs.forEach((f) => f())
}
export function initState(s) { state = s }
/** Selector must return an existing reference or primitive (no fresh objects). */
export function useStore(sel) { return useSyncExternalStore(subscribe, () => sel(state)) }
