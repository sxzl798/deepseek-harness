#!/usr/bin/env python3
"""patch-projects.py — prepend an agenthub hint to each project's AGENTS.md.

Idempotent: detects the existing <!-- agenthub:managed --> marker and
skips files that already have it.

Called by scripts/setup.sh so any project registered in
~/AgentHub/projects.json gets a top-of-file reminder to run
'~/AgentHub/dsh inject' on entry. Works for Claude Code / Codex /
OpenCode because all three read AGENTS.md before any tool call.
"""
import json, sys, re
from pathlib import Path

HUB_DIR = Path.home() / "AgentHub"
PROJECTS_JSON = HUB_DIR / "projects.json"
MARKER = "<!-- agenthub:managed -->"

HINT = """{marker}
# agenthub

This project is registered in agenthub. To pick up where the previous
session left off, run one of:

  ~/AgentHub/dsh inject                                    # standalone CLI
  curl http://127.0.0.1:3080/agenthub-api/context?cwd=$PWD&format=markdown
  /agenthub current                                       # dsh slash command

The output is a markdown block with the project name, path, doctor
summary, and the first 30 lines of docs/HANDOFF.md.
{marker_end}
""".format(marker=MARKER, marker_end="<!-- /agenthub:managed -->")


def main() -> int:
    if not PROJECTS_JSON.exists():
        print(f"{PROJECTS_JSON} not found; run '~/AgentHub/dsh add <path>' first")
        return 1
    data = json.loads(PROJECTS_JSON.read_text())
    n_done = n_skip = n_err = 0
    for name, info in data.get("projects", {}).items():
        path = Path(info.get("path", ""))
        agents = path / "AGENTS.md"
        try:
            existing = agents.read_text() if agents.exists() else ""
        except OSError as e:
            print(f"  skip {name}: read failed ({e})")
            n_err += 1
            continue
        if MARKER in existing:
            print(f"  ·   {name}  (already patched)")
            n_skip += 1
            continue
        # Prepend the hint. Preserve a leading shebang line if present.
        new_text = HINT + "\n" + existing
        try:
            agents.write_text(new_text)
            print(f"  ✓   {name}  (patched: +{len(HINT.splitlines())} lines)")
            n_done += 1
        except OSError as e:
            print(f"  ✗   {name}: write failed ({e})")
            n_err += 1
    print(f"\nDone: {n_done} patched, {n_skip} already patched, {n_err} failed")
    return 0 if n_err == 0 else 2


if __name__ == "__main__":
    sys.exit(main())