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
# A release ID is never reused or overwritten.
mkdir "$destination"
tar -xzf "$staging/agent-release.tar.gz" -C "$destination"
cd "$destination/whitebird-wowaudit-mcp"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
npm test
cd "$destination/whitebird-ai-agent"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
npm test
node --input-type=module -e "await import('@whitebird/wowaudit-mcp')"
timeout 60s node --env-file="$base/shared/agent.env" deploy/check-runtime.mjs
# Activate on the same filesystem only after all checks pass.
ln -s "$destination" "$base/current-$release"
mv -Tf "$base/current-$release" "$base/current"
cat > "$base/bin/whitebird-ask" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
exec node --env-file="$HOME/whitebird/shared/agent.env" \
  "$HOME/whitebird/current/whitebird-ai-agent/src/cli.js" "$@"
WRAPPER
chmod 700 "$base/bin/whitebird-ask"
rm -f "$staging/agent-release.tar.gz"
printf 'Activated release %s\nRun: ~/whitebird/bin/whitebird-ask "your question"\n' "$release"
