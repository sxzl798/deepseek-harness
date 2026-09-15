#!/usr/bin/env bash
# setup.sh — one-command install for the agenthub plugin.
#
# What it does:
#   1. Ensures ~/AgentHub exists
#   2. Clones sxzl798/agent-harness to ~/Developer/agent-harness (if absent)
#   3. Runs pnpm install (handles lefthook/Codex hooksPath clash)
#   4. Writes a dsh profile overlay so the plugin auto-loads on every
#      `pnpm dsh --profile web` boot
#
# After running this, every `pnpm dsh --profile web` automatically loads
# the agenthub plugin and mounts all six REST endpoints under
# /agenthub-api/. The slash command /agenthub becomes available to any
# AI agent running inside the web composition.
#
# Re-running is safe: each step is idempotent.

set -euo pipefail

HUB="${AGENTHUB_DIR:-$HOME/AgentHub}"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
DSH_HARNESS="${AGENTHARNESS_DIR:-$HOME/Developer/agent-harness}"
AGENTHUB_DIR_REL="${AGENTHUB_DIR_REL:-contrib/agenthub}"
AGENTHUB_REPO="${AGENTHUB_REPO:-sxzl798/agent-harness}"
AGENTHUB_PLUGIN_PATH="$DSH_HARNESS/$AGENTHUB_DIR_REL/src/index.ts"

note() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m⚠\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$*"; exit 1; }

# 0. Preflight
note "[1/5] Preflight"
command -v node   >/dev/null 2>&1 || fail "node not found (need v22+)"
command -v pnpm  >/dev/null 2>&1 || fail "pnpm not found (npm i -g pnpm)"
command -v git   >/dev/null 2>&1 || fail "git not found"
NODE_MAJOR="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
[ "$NODE_MAJOR" -ge 22 ] 2>/dev/null || fail "node >= 22 required (have $(node -v))"
ok "node $(node -v), pnpm $(pnpm -v), git $(git --version | awk '{print $3}')"

# 1. Hub directory
note "[2/5] Hub directory"
if [ -d "$HUB" ]; then
  ok "exists: $HUB"
else
  mkdir -p "$HUB"
  ok "created: $HUB"
fi

# 2. Clone fork
note "[3/5] Cloning $AGENTHUB_REPO → $DSH_HARNESS"
if [ -d "$DSH_HARNESS/.git" ]; then
  ok "already cloned: $DSH_HARNESS"
else
  mkdir -p "$(dirname "$DSH_HARNESS")"
  git clone "https://github.com/$AGENTHUB_REPO.git" "$DSH_HARNESS"
  ok "cloned"
fi

# 3. Install
note "[4/5] Installing dependencies"
cd "$DSH_HARNESS"
DSH_LEFTHOOK_ALLOW_HOOKS_PATH_OVERRIDE=1 pnpm install --prefer-offline 2>&1 | tail -3
ok "pnpm install"
# NOTE: We deliberately skip `pnpm run build` here. The plugin lives
# under contrib/ outside the monorepo's packages/*/* glob, so dsh's
# `pnpm run build:lib` does not see it. dsh loads the plugin at runtime
# via `pnpm tsx` on the .ts source (see the overlay below), so a
# monorepo build is not required for the plugin to work.
warn "skipped pnpm run build: this fork only ships the plugin source under"
warn "contrib/, which dsh loads at runtime via tsx."

# 4. Wire the plugin into the dsh web profile via an overlay
note "[5/5] Wiring plugin into dsh web profile"
mkdir -p "$DSH_HOME/profiles/web"
OVERLAY="$DSH_HOME/profiles/web/cordis.patch.yml"

# Idempotency: check whether the overlay already references the agenthub
# plugin (any absolute path ending in the canonical plugin source). This
# avoids duplicating the entry on re-runs without trying to parse YAML.
if grep -q -E "name:.*contrib/agenthub/src/index\\.ts" "$OVERLAY" 2>/dev/null; then
  ok "overlay already references agenthub"
elif grep -q -E "id:\\s*agenthub" "$OVERLAY" 2>/dev/null; then
  # Path moved between versions; rewrite to canonical location.
  warn "overlay references agenthub from an old path; rewriting"
  python3 -c "
import re, sys
p = '$OVERLAY'
text = open(p).read()
text = re.sub(
  r\"(- id:\\s*agenthub\\b.*?name:.*?contrib/agenthub/src/index\\.ts|sd-|[\\s\\S]*?- insert:\\s*\\n\\s*- id:\\s*agenthub\\b[\\s\\S]*?name:.*?)\",
  lambda m: m.group(1).split('name:')[0] + \"name: '$AGENTHUB_PLUGIN_PATH'\\n\",
  text, count=1, flags=re.MULTILINE)
open(p, 'w').write(text)
print('  rewrote overlay entry to use $AGENTHUB_PLUGIN_PATH')
"
else
  # The shipped overlay is `[]`; we replace it with the merged content.
  # dsh expects a single top-level YAML array, so we write one document.
  cat > "$OVERLAY" <<EOF
# Your patch layer for this dsh profile. The top-level value MUST be
# a YAML array of loader patch entries (inserts / overrides / disables).
# Added by sxzl798/agent-harness fork's setup.sh.
- insert:
    - id: agenthub
      name: '$AGENTHUB_PLUGIN_PATH'
EOF
  ok "overlay written: $OVERLAY"
fi

note "Done"
cat <<NEXT

Next steps:
  cd "$DSH_HARNESS"
  pnpm dsh --profile web

Then in your browser:
  http://localhost:3080  (with token in URL)

Try slash commands inside the AI agent:
  /agenthub list
  /agenthub show <project>
  /agenthub skills list
  /agenthub doctor loopagent
  /agenthub profile focus
  /agenthub bundle list
  /agenthub session 10

Or hit the REST API directly:
  curl http://localhost:3080/agenthub-api/projects
  curl http://localhost:3080/agenthub-api/doctor/loopagent
NEXT