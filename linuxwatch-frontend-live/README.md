# LinuxWatch – frontend (live mode)

React 19 dashboard that talks to the LinuxWatch FastAPI + PostgreSQL backend.

## Configure
Edit `public/config.js` (copied to `dist/config.js` on build; you can edit the deployed copy without rebuilding):

    window.LW_CONFIG = { apiUrl: 'http://localhost:8000/api/v1' }

The backend must allow this site's origin in `CORS_ORIGINS` (backend `.env`).

## Run / build
    npm install
    npm run dev        # Vite dev server, http://localhost:5173
    npm run build      # production build in dist/ (serve with any static host / nginx)

(`node build.mjs` is an offline single-file bundler used where npm is unavailable.)

## How it connects
- `src/api/http.js` – fetch wrapper: Bearer token + `X-Workspace-Id`, error messages from the API.
- `src/api/client.js` – every action calls a REST endpoint, then refreshes state from `GET /bootstrap`; a WebSocket (`/ws`) pushes live updates.
- `src/data/metrics.js` – hooks that fetch time series, per-server snapshot and logs from the API.
- Register a first account on the sign-up page, add a server, and run the shown install command on the Linux host.
