#!/usr/bin/env bash
# Pull latest main and restart the Docker container (run on EC2 after git remote is configured).
set -euo pipefail

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
BRANCH="${DEPLOY_BRANCH:-main}"

compose() {
  if docker compose version &>/dev/null; then
    docker compose "$@"
  elif command -v docker-compose &>/dev/null; then
    docker-compose "$@"
  else
    echo "Docker Compose not found. On Amazon Linux run: sudo dnf install -y docker-compose-plugin" >&2
    exit 1
  fi
}

cd "$REPO_DIR"

if [[ -d .git ]]; then
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git pull origin "$BRANCH"
fi

if [[ ! -f .env ]]; then
  echo "Missing .env — copy .env.example to .env and set secrets." >&2
  exit 1
fi

compose build --pull
compose up -d --remove-orphans
compose ps

HOST_PORT="${HOST_PORT:-3000}"
echo "App should be on port ${HOST_PORT} — check: curl -sS http://127.0.0.1:${HOST_PORT}/api/health"
