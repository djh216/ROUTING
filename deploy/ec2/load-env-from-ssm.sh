#!/usr/bin/env bash
# Optional: pull secrets from AWS SSM into .env (requires IAM instance profile + parameters).
# Create parameters in console, e.g. /routing/prod/google_maps_api_key (SecureString).
set -euo pipefail

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
PARAM_PREFIX="${SSM_PARAM_PREFIX:-/routing/prod}"
ENV_FILE="${REPO_DIR}/.env"

if ! command -v aws &>/dev/null; then
  echo "aws CLI not installed — use hand-edited .env instead" >&2
  exit 1
fi

get_param() {
  local name=$1
  aws ssm get-parameter --name "${PARAM_PREFIX}/${name}" --with-decryption --query Parameter.Value --output text 2>/dev/null || true
}

MAPS=$(get_param google_maps_api_key)
ACCESS=$(get_param access_code)
HEALTH=$(get_param health_check_token)

touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

upsert() {
  local key=$1
  local val=$2
  [[ -z "$val" || "$val" == "None" ]] && return
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i.bak "s|^${key}=.*|${key}=${val}|" "$ENV_FILE" && rm -f "${ENV_FILE}.bak"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}

upsert GOOGLE_MAPS_API_KEY "$MAPS"
upsert ACCESS_CODE "$ACCESS"
upsert HEALTH_CHECK_TOKEN "$HEALTH"

echo "Merged SSM parameters under ${PARAM_PREFIX}/ into ${ENV_FILE}"
