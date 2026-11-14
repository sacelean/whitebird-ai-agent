#!/usr/bin/env bash
set -euo pipefail
release=${1:?Release ID required}
[[ "$release" =~ ^[0-9]+-[0-9]+$ ]] || exit 2
base="$HOME/whitebird"
staging="$base/incoming/$release"
destination="$base/releases/$release"
command -v node >/dev/null
command -v npm >/dev/null
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Node >=22 required")'
[[ -f "$base/shared/agent.env" ]] || { echo 'Missing ~/whitebird/shared/agent.env'; exit 1; }
mkdir -p "$base/releases" "$base/bin"
exec 9>"$base/.deploy.lock"
flock -n 9 || { echo 'Another deployment is running'; exit 1; }
previous=$(readlink -f "$base/current" || true)
services=()
if command -v systemctl >/dev/null; then
  systemctl_bin=$(command -v systemctl)
  for unit in whitebird-ai-agent.service whitebird-ai-discord.service; do
    if systemctl is-active --quiet "$unit" || systemctl is-enabled --quiet "$unit"; then
      # Check permissions before interrupting a working service.
      sudo -n -l "$systemctl_bin" stop "$unit" >/dev/null
      sudo -n -l "$systemctl_bin" start "$unit" >/dev/null
      services+=("$unit")
    fi
  done
fi
if [[ " ${services[*]:-} " == *' whitebird-ai-discord.service '* ]]; then
  [[ -f "$base/shared/discord.env" ]] || { echo 'Missing ~/whitebird/shared/discord.env'; exit 1; }
fi
# Prepare and test dependencies while the old release is still serving users.
mkdir "$destination"
tar -xzf "$staging/agent-release.tar.gz" -C "$destination"
cd "$destination/whitebird-wowaudit-mcp"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
npm test
cd "$destination/whitebird-ai-agent"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
npm test
node --input-type=module -e "await import('@whitebird/wowaudit-mcp')"

activated=0
recover() {
  status=$?
  trap - EXIT
  if [[ "$status" != 0 ]]; then
    echo 'Deploy failed; restoring the previous release and service state.' >&2
    # Stop any newly started processes before moving current back.
    for ((i=${#services[@]}-1; i>=0; i--)); do
      if ! sudo -n "$systemctl_bin" stop "${services[i]}"; then
        echo 'Could not stop service for rollback; manual recovery required.' >&2
        exit "$status"
      fi
    done
    if [[ "$activated" == 1 ]]; then
      if [[ -n "$previous" ]]; then
        ln -s "$previous" "$base/rollback-$release"
        mv -Tf "$base/rollback-$release" "$base/current"
      else
        rm -f "$base/current"
      fi
    fi
    for unit in "${services[@]}"; do
      sudo -n "$systemctl_bin" start "$unit" || echo "Could not restore $unit; manual recovery required." >&2
    done
  fi
  exit "$status"
}
trap recover EXIT
# No runtime checks or CLI may share OAuth with the HTTP service.
for ((i=${#services[@]}-1; i>=0; i--)); do
  sudo -n "$systemctl_bin" stop "${services[i]}"
done
timeout 60s node --env-file="$base/shared/agent.env" deploy/check-runtime.mjs
if [[ " ${services[*]:-} " == *' whitebird-ai-discord.service '* ]]; then
  node --env-file="$base/shared/discord.env" src/discord.js --register
fi
ln -s "$destination" "$base/current-$release"
mv -Tf "$base/current-$release" "$base/current"
activated=1
for unit in "${services[@]}"; do
  sudo -n "$systemctl_bin" start "$unit"
  if [[ "$unit" == whitebird-ai-agent.service ]]; then
    node --env-file="$base/shared/agent.env" deploy/check-service.mjs
  fi
done
for unit in "${services[@]}"; do
  systemctl is-active --quiet "$unit"
done
cat > "$base/bin/whitebird-ask" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
exec node --env-file="$HOME/whitebird/shared/agent.env" \
  "$HOME/whitebird/current/whitebird-ai-agent/src/cli.js" "$@"
WRAPPER
chmod 700 "$base/bin/whitebird-ask"
rm -f "$staging/agent-release.tar.gz"
printf 'Activated release %s\n' "$release"
