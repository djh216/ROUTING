#!/usr/bin/env bash
# Collect Caddy / HTTPS diagnostics on EC2 (no secrets).
set -u

echo "=== caddy binary ==="
command -v caddy && caddy version || echo "caddy not in PATH"

echo "=== caddy validate ==="
sudo caddy validate --config /etc/caddy/Caddyfile 2>&1 || true

echo "=== systemd ==="
systemctl is-enabled caddy 2>&1 || true
systemctl is-active caddy 2>&1 || true
sudo systemctl status caddy --no-pager 2>&1 | head -20 || true

echo "=== journal (last 30) ==="
sudo journalctl -u caddy -n 30 --no-pager 2>&1 || true

echo "=== listeners 80/443/3000 ==="
sudo ss -tlnp | grep -E ':80 |:443 |:3000 ' || true

echo "=== app health ==="
curl -sS -m 3 http://127.0.0.1:3000/api/health 2>&1 | head -c 200 || echo "app not on 3000"

echo "=== curl localhost https (insecure) ==="
curl -sS -m 5 -k -I https://127.0.0.1/ 2>&1 | head -5 || true

echo "=== .env domain ==="
grep '^ROUTING_DOMAIN=' ~/ROUTINGv2/.env 2>/dev/null || true

echo "=== Caddyfile ==="
sudo cat /etc/caddy/Caddyfile 2>/dev/null || true

echo "=== SELinux ==="
getenforce 2>/dev/null || true
