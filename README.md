# PA Wine Distributor Routing

Route planning app for a Pennsylvania wine distributor operating from **Scranton, PA**.

## Features

- **8 territories** with schedules from `Territories and Delivery.xlsx`
- **Territory cutoffs** — orders approved by cutoff must ship on the next delivery day
- **Scranton hub** — all routes depart from 310 Genet Street, Scranton PA
- **Pittsburgh multi-day** — Tuesday 2:30 PM cutoff; Wednesday primary + Thursday overflow; truck stays out overnight (no warehouse return between days)
- **Variable Wed threshold** — auto-suggested stop count for Pittsburgh; slider + drag-and-drop override
- **Route Board** — drag-and-drop stop reordering and cross-segment moves for all routes (days for Pittsburgh, trucks for other territories)
- **Live validation** — ETAs checked against 10 AM – 4 PM delivery windows and driver hours
- **10 AM first stop** — every delivery day starts at 10:00 AM; departure is back-calculated; remaining stops run back-to-back to finish as early as possible
- **Weekly CSV upload** — import ordering customers with contact info and delivery instructions at the start of each week
- **Google Maps drive times** — ETAs and route optimization use Google Maps Distance Matrix (traffic-aware for delivery day); falls back to estimates if no API key
- **Live map** — road-following route lines from Google Directions API, updating as stops are reordered

## Google Maps setup

Drive times between the warehouse and each account (and between stops) use the **Google Maps Distance Matrix API**. Route map lines use the **Directions API**.

1. Create a Google Cloud project and enable **Distance Matrix API** and **Directions API**
2. Create an API key and restrict it appropriately (server IP or unrestricted for local dev)
3. Copy `.env.example` to `.env` and set your key:

```bash
GOOGLE_MAPS_API_KEY=your_key_here
```

Restart the API server after setting the key. Without it, the app uses straight-line distance estimates at 45 mph.

## GitHub Pages (dashboard hosting)

The built dashboard is published as static files at the repo root:

- `index.html` — entry point for GitHub Pages
- `assets/` — compiled JS/CSS

Regenerate after UI changes:

```bash
npm run build:pages
```

**Enable Pages:** GitHub repo → Settings → Pages → Source: **GitHub Actions** (workflow deploys on push to `main`).

Or serve from the **main** branch root if you commit `index.html` and `assets/` directly.

**Custom domain:** Set `fmwlogistics.com` under Pages settings after adding the DNS TXT verification record.

**API note:** GitHub Pages serves the frontend only. Run the Node API separately (`npm start`) and set repository variable `VITE_API_URL` (e.g. `https://api.fmwlogistics.com/api`) so the hosted dashboard can reach it.

When a route is built, drive times are fetched once for all stops in that territory batch and cached for drag-and-drop updates.

## Weekly customer CSV

Upload your weekly export from the sidebar (**Upload CSV**) to get started — the app begins with no customers or routes loaded. Use these columns (exact headers from your export are supported):

| Column | Description |
|--------|-------------|
| `account name(Restaurant)` | Restaurant / account name |
| `street 1 (Address - Street 1)` | Street address |
| `City(Address - City)` | City |
| `Phone Number(...)` | Contact's first name + phone, e.g. `Maria 215-555-0101` |
| `Delivery instructions(...)` | Driver notes for that restaurant |
| `Territory(...)` | One of your 8 PA territories |

Addresses are geocoded automatically for routing (no lat/lng needed). Optional column: `cycle` (Philadelphia 1 or 2).

Click **Download template** for a starter file with the correct headers.

## Quick start

```bash
cd wine-routing
npm install
npm run dev
```

- **UI:** http://localhost:5173
- **API:** http://localhost:3001

## Territory schedule

| Territory | Cutoff | Delivery |
|-----------|--------|----------|
| Philadelphia (cycle 1) | Tue 2:30 PM | Wed 10 AM – 4 PM |
| Philadelphia (cycle 2) | Wed 2:30 PM | Thu 10 AM – 4 PM |
| Western Philly Suburbs | Tue 2:30 PM | Wed |
| Southern Susquehanna Valley | Tue 2:30 PM | Wed |
| Pittsburgh | Tue 2:30 PM | Wed + Thu overflow |
| Northern Philly Suburbs | Wed 2:30 PM | Thu |
| Northeast PA | Thu 2:30 PM | Fri |
| Lehigh Valley | Thu 2:30 PM | Fri |
| Northern Susquehanna Valley | Thu 2:30 PM | Fri |

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/batches` | List locked-eligible batches |
| GET | `/api/routes/:cycleId` | Get or create route plan |
| POST | `/api/routes/:cycleId/segments` | Update segment stop assignments |
| POST | `/api/routes/:cycleId/wed-threshold` | Set Pittsburgh Wed stop count |
| POST | `/api/routes/:cycleId/add-truck` | Add truck segment (single-day routes) |
| POST | `/api/routes/:cycleId/reset` | Reset to auto-suggested route |
| POST | `/api/routes/:cycleId/lock` | Lock route for dispatch |
