#!/usr/bin/env bash
# Install Docker Compose v2 CLI plugin when the OS package is unavailable (Amazon Linux 2023).
set -euo pipefail

if docker compose version &>/dev/null 2>&1; then
  echo "docker compose already available"
  exit 0
fi

COMPOSE_VERSION="${COMPOSE_VERSION:-2.29.7}"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) ARCH=amd64 ;;
  aarch64) ARCH=arm64 ;;
esac

PLUGIN_DIR="/usr/local/lib/docker/cli-plugins"
sudo mkdir -p "$PLUGIN_DIR"
sudo curl -fsSL \
  "https://github.com/docker/compose/releases/download/v${COMPOSE_VERSION}/docker-compose-linux-${ARCH}" \
  -o "$PLUGIN_DIR/docker-compose"
sudo chmod +x "$PLUGIN_DIR/docker-compose"

docker compose version
