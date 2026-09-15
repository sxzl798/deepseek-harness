# @sxzl798/agenthub

A DeepSeek Harness plugin that exposes the user-owned canonical Skill and
Project registry to any AI agent running inside dsh.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/sxzl798/agent-harness/master/scripts/setup.sh | bash
```

Or read [scripts/setup.sh](./scripts/setup.sh) and run it manually — it just
clones the fork, builds, and writes one overlay file to `~/.dsh/profiles/web/`.

## What it does

Adds the following to every `pnpm dsh --profile web` boot:

### Slash command: `/agenthub`

| Subcommand | Effect |
|---|---|
| `/agenthub list`             | List every registered project (table) |
| `/agenthub show <name>`      | Show one project's metadata |
| `/agenthub add <path>`       | Register a new project |
| `/agenthub remove <name>`    | Unregister a project |
| `/agenthub skills list`      | List hub skills (name + description) |
| `/agenthub skills show <n>`  | Show one skill's full body |
| `/agenthub doctor [name]`    | Run agent-portable checks; default `all` |
| `/agenthub profile`          | List profiles with active marker |
| `/agenthub profile show <n>` | Show profile body + extracted prompt prefix |
| `/agenthub profile <name>`   | Activate a profile (writes `.active_profile`) |
| `/agenthub bundle`           | List bundles |
| `/agenthub bundle show <n>`  | Show one bundle (yaml dump) |
| `/agenthub session [N]`      | Tail the last N session log entries |

Every invocation (except `session`) is recorded in
`~/AgentHub/sessions/<YYYY-MM-DD>.jsonl` so you can audit what your AI
agents have been doing.

### REST API: `/agenthub-api/`

| Endpoint | Effect |
|---|---|
| `GET /agenthub-api/projects`             | Every project with a per-project doctor summary |
| `GET /agenthub-api/skills`               | Hub skills |
| `GET /agenthub-api/status`               | Hub summary (counts, paths, active profile) |
| `GET /agenthub-api/doctor/<name\|all>`   | Agent-portable checks |
| `POST /agenthub-api/add`                 | Register a project (`{path, name?}`) |
| `POST /agenthub-api/remove`              | Unregister (`{name}`) |

We live at `/agenthub-api/` instead of `/api/` because dsh routes
`/api/**` through the browser trust fence, which would 401 any
unauthenticated curl call.

### Services

```ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    'agenthub.registry': RegistryService
    'agenthub.skills': SkillsService
    'agenthub.doctor': DoctorService
    'agenthub.profiles': ProfilesService
    'agenthub.bundles': BundlesService
  }
}
```

Other plugins can `inject: ['agenthub.registry', ...]` and consume
these services directly.

## Layout

```
packages/agenthub/agenthub/
├── src/
│   ├── index.ts        # apply(ctx): mounts services, registers commands
│   ├── registry.ts     # RegistryService — projects.json
│   ├── skills.ts       # SkillsService — ~/AgentHub/skills/
│   ├── doctor.ts       # DoctorService — 7 agent-portable checks
│   ├── profiles.ts     # ProfilesService — focus/explore/ship
│   ├── bundles.ts      # BundlesService — dsh-ppt/dsh-web/dsh-mcp
│   ├── sessions.ts     # SessionRecorder — JSONL log
│   └── web.ts          # REST endpoints on dsh webServer
├── package.json
├── cordis.yml          # how dsh loader mounts this plugin
└── README.md          # this file

scripts/
├── setup.sh           # one-command install
├── smoke-agenthub.mts # exercises all services outside dsh
├── smoke-sessions.mts  # exercises session log
└── smoke-profiles-bundles.mts
```

## Compatibility with the bash `~/AgentHub/`

The plugin reads the **same** files the bash `~/AgentHub/dsh` script
does (`projects.json`, `skills/`, `profiles/`, `bundles/`, etc.), so
the two implementations stay interoperable. A user can mix:

```bash
# Register a project via the plugin slash command...
/agenthub add ~/code/newproj

# ...and the bash tool will see it on the next list.
~/AgentHub/dsh list
```

The plugin writes through `RegistryService.add/remove`, which uses
atomic rename on `projects.json`. The bash `~/AgentHub/dsh add/remove`
also writes through the same file. Last writer wins, but the file
format is stable.

## Status: v0.7.0

| Version | Feature |
|---|---|
| v0.2.0 | `RegistryService` — `projects.json` with atomic writes |
| v0.3.0 | `SkillsService` — SKILL.md frontmatter parser |
| v0.4.0 | `DoctorService` — 7 agent-portable compliance checks |
| v0.5.0 | REST API on the dsh webServer |
| v0.6.0 | `SessionRecorder` — append-only JSONL session log |
| v0.7.0 | `ProfilesService` + `BundlesService` |
| v1.0.0 | Setup script + smoke tests + upstream PR draft |

See `docs/HANDOFF.md` in the fork's `loopagent/` mirror for the
full Phase 0-5 development log.