// Offline build: bundles with esbuild into one self-contained HTML file (no npm registry needed).
import { build } from '/opt/npm-tools/node_modules/esbuild/lib/main.js'
import fs from 'node:fs'
const out = await build({ entryPoints: ['src/main.jsx'], bundle: true, minify: true, write: false, format: 'iife', jsx: 'automatic', target: 'es2020', define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.css': 'css' }, outdir: 'dist', nodePaths: ['node_modules'], logLevel: 'warning' })
const js = out.outputFiles.find((f) => f.path.endsWith('.js')).text.replace(/<\/script/g, '<\\/script')
const css = out.outputFiles.find((f) => f.path.endsWith('.css'))?.text || ''
fs.mkdirSync('dist', { recursive: true })
fs.writeFileSync('dist/index.html', `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>LinuxWatch</title><style>${css}</style></head><body><div id="root"></div><script src="config.js"></script><script>${js}</script></body></html>`)
fs.copyFileSync('public/config.js', 'dist/config.js')
console.log('built', (fs.statSync('dist/index.html').size / 1024).toFixed(0) + ' KB')
