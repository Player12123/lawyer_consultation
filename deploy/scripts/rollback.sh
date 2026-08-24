#!/usr/bin/env bash
set -euo pipefail

# Reverts only the application release symlink. Database recovery is an
# explicit, separately authorized operation documented in rollback-runbook.md.
if [[ "${1:-}" == "--database-restore" ]]; then
  echo "Refusing database restoration. Follow docs/rollback-runbook.md with an approved backup." >&2
  exit 64
fi

release_root="${RELEASE_ROOT:-/opt/pocket-legal-assistant/releases}"
current_link="${CURRENT_LINK:-/opt/pocket-legal-assistant/current}"
target_release="${1:-}"

if [[ -z "$target_release" || "$target_release" == -* ]]; then
  echo "Usage: $0 <previous-release-directory>" >&2
  exit 64
fi
if [[ ! -d "$release_root/$target_release" || ! -f "$release_root/$target_release/package.json" ]]; then
  echo "Target release is not a valid release directory: $target_release" >&2
  exit 65
fi
if [[ ! -L "$current_link" ]]; then
  echo "Current application path must be a symlink: $current_link" >&2
  exit 65
fi

previous_target="$(readlink "$current_link")"
ln -sfn "$release_root/$target_release" "$current_link"

if systemctl restart pocket-legal-api pocket-legal-web && curl --fail --silent --show-error http://127.0.0.1:8788/readyz >/dev/null; then
  echo "Application rollback completed: $previous_target -> $target_release"
  exit 0
fi

echo "Rollback health check failed; restoring previous application release." >&2
ln -sfn "$previous_target" "$current_link"
systemctl restart pocket-legal-api pocket-legal-web || true
exit 1
