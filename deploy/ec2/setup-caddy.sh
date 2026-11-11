#!/usr/bin/env bash
# Install Caddy and install site config from ROUTING_DOMAIN in .env (HTTPS on 443).
set -euo pipefail

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$REPO_DIR"

if [[ ! -f .env ]]; then
  echo "Missing .env — set ROUTING_DOMAIN before setup-caddy.sh" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

if [[ -z "${ROUTING_DOMAIN:-}" ]]; then
  echo "Set ROUTING_DOMAIN in .env (DNS A record must point at this instance)" >&2
  exit 1
fi

if ! command -v envsubst &>/dev/null; then
  if command -v apt-get &>/dev/null; then
    sudo apt-get install -y gettext-base
  elif command -v dnf &>/dev/null; then
    sudo dnf install -y gettext
  fi
fi

install_caddy_binary() {
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64) DL_ARCH=amd64 ;;
    aarch64) DL_ARCH=arm64 ;;
    *) echo "Unsupported arch: $ARCH" >&2; exit 1 ;;
  esac
  sudo curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=${DL_ARCH}" -o /usr/bin/caddy
  sudo chmod +x /usr/bin/caddy
  command -v setcap &>/dev/null && sudo setcap 'cap_net_bind_service=+ep' /usr/bin/caddy || true
}

install_caddy_dnf() {
  sudo dnf install -y dnf-plugins-core curl
  if [[ ! -f /etc/yum.repos.d/caddy-stable.repo ]]; then
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo tee /etc/pki/rpm-gpg/RPM-GPG-KEY-caddy-stable >/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/rpm/caddy-stable.repo' | sudo tee /etc/yum.repos.d/caddy-stable.repo
  fi
  if ! sudo dnf install -y caddy; then
    echo "dnf caddy package unavailable; installing official binary..." >&2
    install_caddy_binary
  fi
}

install_caddy_apt() {
  sudo apt-get update
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
  sudo apt-get update
  sudo apt-get install -y caddy
}

ensure_systemd_unit() {
  if systemctl list-unit-files caddy.service &>/dev/null 2>&1 | grep -q caddy.service; then
    return 0
  fi
  if [[ -f /lib/systemd/system/caddy.service ]] || [[ -f /usr/lib/systemd/system/caddy.service ]]; then
    return 0
  fi
  echo "Installing caddy.service unit..."
  if ! id -u caddy &>/dev/null; then
    sudo useradd --system --home /var/lib/caddy --shell /sbin/nologin caddy
  fi
  sudo mkdir -p /var/lib/caddy
  sudo chown caddy:caddy /var/lib/caddy
  sudo cp "$REPO_DIR/deploy/ec2/caddy.service" /etc/systemd/system/caddy.service
  sudo systemctl daemon-reload
}

if ! command -v caddy &>/dev/null; then
  if command -v dnf &>/dev/null; then
    install_caddy_dnf
  elif command -v apt-get &>/dev/null; then
    install_caddy_apt
  else
    install_caddy_binary
  fi
fi

ensure_systemd_unit

sudo mkdir -p /etc/caddy

TEMP=$(mktemp)
export ROUTING_DOMAIN
envsubst '$ROUTING_DOMAIN' < "$REPO_DIR/deploy/ec2/Caddyfile.template" > "$TEMP"
sudo cp "$TEMP" /etc/caddy/Caddyfile
rm -f "$TEMP"

if ! sudo caddy validate --config /etc/caddy/Caddyfile; then
  echo "Caddyfile invalid — check ROUTING_DOMAIN and /etc/caddy/Caddyfile" >&2
  exit 1
fi

sudo systemctl enable caddy
sudo systemctl restart caddy
sleep 2
if ! systemctl is-active --quiet caddy; then
  echo "Caddy failed to start. Run: ./deploy/ec2/troubleshoot-caddy.sh" >&2
  sudo journalctl -u caddy -n 20 --no-pager
  exit 1
fi
sudo systemctl --no-pager --full status caddy || true

echo "Caddy serving https://${ROUTING_DOMAIN} -> 127.0.0.1:3000"
echo "Security group should allow 80/443 only (not public 3000)."
