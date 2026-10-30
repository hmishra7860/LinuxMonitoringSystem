import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/app.css'
import App from './App.jsx'
import { bootstrap, toast } from './api/client.js'

bootstrap()
// Any failed API call that a page did not handle itself is shown as an error toast.
window.addEventListener('unhandledrejection', (e) => { e.preventDefault(); if (e.reason?.message) toast('error', e.reason.message) })
createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
