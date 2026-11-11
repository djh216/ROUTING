# AWS EC2 + Docker hosting (secure PoC)

Run the **full app** (UI + API) on one EC2 instance. **HTTPS on port 443** is the default path; the app container listens on **127.0.0.1:3000** only (not public). Data (CSV, routes) stays **in memory** until the container restarts.

## Architecture

```text
Internet → (optional Cloudflare) → Caddy TLS :443 → 127.0.0.1:3000 Docker app → Google Maps APIs
```

## 1. Create EC2

| Setting | Suggestion |
|---------|----------------|
| AMI | Amazon Linux 2023 or Ubuntu 22.04 |
| Instance type | `t3.small` |
| Storage | 20 GB gp3 |
| Elastic IP | Attach; use for Google Maps **IP restriction** and DNS |
| Security group | **443** and **80** from `0.0.0.0/0` (or restrict to office/VPN); **22** SSH from **your IP only**; **do not** open **3000** to the internet |

Set a **CloudWatch billing alarm** (Billing → Budgets or CloudWatch alarm on estimated charges) e.g. $25–50/month on your personal account.

### DNS

Create an **A record** for **`magnottarouting.com`** (record name **blank** in Route 53) → **Elastic IP**. Let's Encrypt (via Caddy) requires a real hostname, not a bare IP.

## 2. Install on the instance

**Private repo:** EC2 needs read access to GitHub. Use a **deploy key** (recommended): generate `ssh-keygen -t ed25519 -f routing-deploy -N ""`, add `routing-deploy.pub` under repo **Settings → Deploy keys** (read-only), copy the private key to the instance (e.g. `~/.ssh/routing-deploy`, `chmod 600`), then clone with SSH. GitHub Actions `git pull` in `redeploy.sh` uses the same `origin` URL.

```bash
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/routing-deploy
git clone git@github.com:3potato4/ROUTINGv2.git
cd ROUTINGv2
cp deploy/ec2/env.production.example .env
chmod +x deploy/ec2/*.sh
./deploy/ec2/bootstrap.sh
# Log out/in if bootstrap added you to the docker group
```

### Secrets (never in git)

| Secret | Where it lives |
|--------|----------------|
| `GOOGLE_MAPS_API_KEY` | `.env` on EC2 (`chmod 600`) or AWS SSM via [load-env-from-ssm.sh](ec2/load-env-from-ssm.sh) |
| `ACCESS_CODE` | Same `.env` / SSM |
| `HEALTH_CHECK_TOKEN` | Same `.env` / SSM (optional; gates public `/api/health` detail) |
| `EC2_SSH_PRIVATE_KEY` | **GitHub Actions Secrets only** (deploy); not on the instance |
| TLS certificates | Caddy auto-managed on disk |
| AWS root / IAM user keys | **Not needed** for this PoC (SSH deploy; optional SSM uses **instance IAM role**) |

**`.env` on EC2** (start from [`deploy/ec2/env.production.example`](ec2/env.production.example)):

```bash
ROUTING_DOMAIN=magnottarouting.com
APP_URL=https://magnottarouting.com
GOOGLE_MAPS_API_KEY=...   # set on server; restrict to Elastic IP in GCP
ACCESS_CODE=...           # set on server
HEALTH_CHECK_TOKEN=...    # optional
NODE_ENV=production
TRUST_PROXY=true
COOKIE_SECURE=true
RATE_LIMIT_ENABLED=true
```

**Optional SSM:** create SecureString parameters `/routing/prod/google_maps_api_key`, `access_code`, `health_check_token`, attach `AmazonSSMReadOnlyAccess` (or tighter) to the EC2 instance role, then:

```bash
./deploy/ec2/load-env-from-ssm.sh
```

### Google Maps key hardening (console)

1. **API restrictions:** Geocoding API, Distance Matrix API, Directions API only.
2. **Application restrictions:** IP addresses → your **Elastic IP**.
3. **Quotas:** set per-day caps on Distance Matrix / Directions / Geocoding.
4. **Billing:** budget + email alert on the GCP project.

The browser never receives the Maps key; only server routes in `server/` call Google. The frontend uses relative `/api` ([`src/lib/api.ts`](../src/lib/api.ts)).

### Start app + HTTPS

```bash
./deploy/ec2/redeploy.sh
sudo ./deploy/ec2/setup-caddy.sh
```

**Share link (encrypted):** `https://magnottarouting.com/?code=<ACCESS_CODE>`

**Health:** Docker hits `http://127.0.0.1:3000/api/health` inside the container (full detail). From the internet, if `HEALTH_CHECK_TOKEN` is set, use header `X-Health-Token` or `?token=`; otherwise callers get `404`.

## 3. Rate limits (abuse / Maps spend)

Enabled when `RATE_LIMIT_ENABLED` is not `false` (defaults on):

| Tier | Scope | Default |
|------|--------|---------|
| Global | All routes except health | 300 / 15 min / IP |
| Auth gate | `POST /`, `GET /?code=` | 10 / 15 min / IP |
| Expensive | `build`, `geometry`, `reoptimize`, `apply-traffic`, `regeocode` | 60 / 15 min / IP |
| Upload | `POST /api/customers/upload` | 5 / hour / IP |

Requires `TRUST_PROXY=true` behind Caddy so client IP is correct.

## 4. Optional Cloudflare (DDoS / hide origin)

Use when the URL is on the public internet:

1. Add the site to Cloudflare; point DNS to Cloudflare (orange cloud).
2. SSL/TLS mode **Full (strict)**; origin = your Elastic IP or hostname.
3. Optional **Rate limiting** rules on `/api/*` and `/` (free tier has basic limits).
4. Restrict security group **443** to [Cloudflare IP ranges](https://www.cloudflare.com/ips/) if you want origin to accept only Cloudflare (advanced).

Alternate without opening inbound 443: **Cloudflare Tunnel** (`cloudflared`) to `127.0.0.1:3000` — see [Cloudflare Tunnel docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/).

## 5. GitHub Actions deploy

### Self-hosted runner (default)

Production deploys run on the EC2 box via a **repository** self-hosted runner:

| Item | Value |
|------|--------|
| Runner name | `magnotta-ec2-routing` |
| Install path | `~/runner-routing` (user `ec2-user`) |
| Service | `actions.runner.*.service` (systemd) |
| Labels | `self-hosted`, `Linux`, `X64`, `routing` |
| App clone | `/home/ec2-user/ROUTINGv2` |

Flow: push to **`main`** (or manual **workflow_dispatch**) runs [`.github/workflows/deploy-aws-ec2-self-hosted.yml`](../.github/workflows/deploy-aws-ec2-self-hosted.yml) on the runner with label **`routing`**. The job runs `deploy/ec2/redeploy.sh` in the server clone (git pull `main`, `docker compose` rebuild/restart), then curls `http://127.0.0.1:3000/api/health` until `ok: true`.

Optional Actions variable **`EC2_APP_DIR`** overrides the clone path (default `~/ROUTINGv2` on the runner).

Because the repo is **public**, ensure **Settings → Actions → General** allows self-hosted runners for this repository (fork PR workflows must **not** use this runner; the self-hosted workflow has no `pull_request` triggers).

### SSH deploy (legacy, manual only)

Repository **Secrets** (for optional SSH fallback):

| Secret | Example |
|--------|---------|
| `EC2_HOST` | `magnottarouting.com` or your Elastic IP |
| `EC2_USER` | `ec2-user` (Amazon Linux 2023) or `ubuntu` |
| `EC2_SSH_PRIVATE_KEY` | `.pem` contents |

Workflow: [`.github/workflows/deploy-aws-ec2.yml`](../.github/workflows/deploy-aws-ec2.yml) — **`workflow_dispatch` only** (no push). Requires inbound SSH from GitHub-hosted runners unless you open port 22.

### Troubleshooting: `dial tcp …:22: i/o timeout`

GitHub Actions runs on **random cloud IPs**, not your laptop. If SSH from your machine works but Actions fails with a **30s timeout**, the instance is almost always blocking port 22 from the internet.

**Fix A — allow SSH from anywhere (simple PoC)**  
EC2 → instance → **Security** → security group → **Edit inbound rules** → SSH (22) → source **`0.0.0.0/0`** (authentication still requires your `.pem`). Save, then re-run the workflow.

**Fix B — keep SSH locked to your IP (recommended)**  
Do **not** open 22 to the world. Use a **self-hosted GitHub Actions runner** on the same EC2 box ([`deploy-aws-ec2-self-hosted.yml`](../.github/workflows/deploy-aws-ec2-self-hosted.yml)): the job runs locally and calls `redeploy.sh` with no inbound SSH from GitHub.

**Also check**

| Check | Detail |
|-------|--------|
| `EC2_HOST` | Public **IPv4** or EC2 public DNS — not a private `10.x` address |
| Same host as manual SSH | Use the exact hostname/IP that works in `ssh -i key.pem user@host` |
| Instance running | Stopped instances time out |
| Elastic IP | If you use a DNS name, it must point at the instance’s current public IP |

Workflow **Verify deploy secrets** passing + **Deploy over SSH** timing out ⇒ secrets are fine; network/security group is the problem.

## 6. Local Docker test (no Caddy)

```bash
cp .env.example .env
# ACCESS_CODE=...; COOKIE_SECURE=false; leave ROUTING_DOMAIN unset
docker compose up --build
```

Open `http://127.0.0.1:3000/?code=<ACCESS_CODE>` (compose binds localhost only).

## AWS containers (reference)

Images are standard **Docker/OCI**. This PoC builds on the EC2 host with `docker compose build`.
