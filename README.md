# Wine distributor routing

Route planning for multi-territory delivery from a **northeastern Pennsylvania hub** (configurable depot in code).

## Features

- **8 territories** with schedules aligned to your delivery workbook
- **Territory cutoffs** — orders approved by cutoff must ship on the next delivery day
- **Central depot** — all routes depart from a single hub (see `shared/constants.ts`)
- **Pittsburgh multi-day** — Tuesday 2:30 PM cutoff; Wednesday primary, Thursday overflow, and an optional Friday. The planner adds Friday when Thursday cannot finish the run, and you can add it yourself. The truck stays out overnight (no warehouse return between days)
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
2. Create an API key and restrict it to your server’s public IP in production (local dev can use a separate unrestricted dev key)
3. Copy `.env.example` to `.env` and set your key:

```bash
GOOGLE_MAPS_API_KEY=your_key_here
```

Restart the API server after setting the key. Without it, the app uses straight-line distance estimates at 45 mph.

## Production hosting (optional)

The full app (UI + API) can run in Docker on a single VM with HTTPS in front and an optional **access code** for team access (configured via environment variables — never committed).

- **Guide:** [deploy/aws-ec2.md](deploy/aws-ec2.md) — Caddy TLS, secrets on the host only, rate limits
- **Local Docker:** `docker compose up --build` (see `.env.example`; set `COOKIE_SECURE=false` for plain HTTP on loopback)
- **Deploy automation:** GitHub Actions workflows under `.github/workflows/` (requires repository secrets configured on the host side)

Customer and route data are **in memory**; restarting the container clears the week’s upload until someone imports the CSV again.

When a route is built, drive times are fetched once for all stops in that territory batch and cached for drag-and-drop updates.

## Weekly customer CSV

Upload your weekly export from the sidebar (**Upload CSV**) to get started — the app begins with no customers or routes loaded. Supported column headers include:

| Column | Description |
|--------|-------------|
| `account name(Restaurant)` | Restaurant / account name |
| `street 1 (Address - Street 1)` | Street address |
| `City(Address - City)` | City |
| `Phone Number(...)` | Contact's first name + phone |
| `Delivery instructions(...)` | Driver notes for that restaurant |
| `Territory(...)` | Territory name |

Addresses are geocoded automatically for routing (no lat/lng needed). Optional column: `cycle` (Philadelphia 1 or 2).

Click **Download template** in the app for a starter file with the correct headers.

## Quick start

```bash
npm install
npm run dev
```

Open **http://localhost:3000** (single process serves UI and API). With `ACCESS_CODE` set in `.env`, use the login form or your configured access flow — do not publish real codes in documentation.

## Territory schedule

| Territory | Cutoff | Delivery |
|-----------|--------|----------|
| Philadelphia (cycle 1) | Tue 2:30 PM | Wed 10 AM – 4 PM |
| Philadelphia (cycle 2) | Wed 2:30 PM | Thu 10 AM – 4 PM |
| Western Philly Suburbs | Tue 2:30 PM | Wed |
| Southern Susquehanna Valley | Tue 2:30 PM | Wed |
| Pittsburgh | Tue 2:30 PM | Wed + Thu overflow, optional Fri |
| Northern Philly Suburbs | Wed 2:30 PM | Thu |
| Northeast PA | Thu 2:30 PM | Fri |
| Lehigh Valley | Thu 2:30 PM | Fri |
| Northern Susquehanna Valley | Thu 2:30 PM | Fri |

## API

REST endpoints live under `/api`. When `ACCESS_CODE` is set in production, unauthenticated clients receive `401` except for health checks as configured.

Implementation details: `server/index.ts` and `src/lib/api.ts`. Prefer running behind HTTPS and keeping keys and access codes only in server environment variables.
