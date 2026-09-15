# @sxzl798/agenthub

A DeepSeek Harness plugin that replaces the bash `~/AgentHub/` tool with a
Cordis-native service. The plugin owns the canonical project registry
(`projects.json`) and exposes slash commands the AI agent can call inside the
DSH web UI.

## Status: v0.2.0 (Phase 1.A — registry live)

| Version | Feature |
|---|---|
| **v0.1.0** | Hello-world: proves plugin loads into `dsh --profile web` |
| **v0.2.0** | `RegistryService` mounts on `ctx.agenthub.registry`; `/agenthub list\|show\|add\|remove` slash commands |
| v0.3.0 | `SkillsService` for the hub skills directory |
| v0.4.0 | `DoctorService` wrapping the agent-doctor checks |
| v0.5.0 | Web UI route mounted on the dsh web framework |
| v0.6.0 | Profile + bundle services (focus/explore/ship + dsh-ppt/dsh-web/...) |

## Slash commands

The plugin registers `/agenthub` as a single slash command that dispatches
on its first argument:

| Command | Effect |
|---|---|
| `/agenthub list`            | List all registered projects (table) |
| `/agenthub show <name>`     | Print one project's metadata |
| `/agenthub add <path>`      | Register a new project (path is required; type/tags default) |
| `/agenthub remove <name>`   | Unregister a project |

All commands return text suitable for the AI agent's context.

## Service contract

```ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    'agenthub.registry': RegistryService
  }
}

class RegistryService extends Service {
  static defaultHubDir(): string        // env-driven
  async list(): Promise<Record<string, Project>>
  async show(name: string): Promise<Project | null>
  async add(name: string, project: Project): Promise<void>
  async remove(name: string): Promise<void>
  async goPath(name: string): Promise<string | null>
  async read(): Promise<RegistryFile>  // raw, for migrations
  async write(data: RegistryFile): Promise<void>  // atomic rename
}
```

Other plugins can `inject: ['agenthub.registry']` and consume the service.

## Layout

```
packages/agenthub/agenthub/
├── src/
│   ├── index.ts        # Plugin entry: apply(ctx); mounts service + slash commands
│   └── registry.ts     # RegistryService class + Project/RegistryFile types
├── package.json        # Workspace member
├── cordis.yml          # Overlay that registers this plugin in the web profile
└── README.md           # this file
```

## How it loads

```sh
pnpm dsh --profile web --patch ./packages/agenthub/agenthub/cordis.yml
```

The `--patch` argument tells the dsh loader to apply `cordis.yml` as a
transient overlay on top of the shipped web profile. The overlay inserts
one entry:

```yaml
- insert:
    - id: agenthub
      name: 'file:///absolute/path/to/packages/agenthub/agenthub/src/index.ts'
```

The loader reads `src/index.ts` directly via `tsx`, calls its `apply(ctx)`,
and the registry service + slash commands become part of the running tree.

## Next steps (v0.3.0)

- `SkillsService` reading `~/AgentHub/skills/`
- `/agenthub skills list` and `/agenthub skills sync` slash commands
- `/agenthub status` upgraded to also report skill count