/**
 * AgentHub — Phase 0 entry. The hello-world plugin proves dsh loads us on
 * every `--profile web` boot via the `apply()` trace below. Phase 1 wires
 * the `RegistryService` (projects.json) into the live tree.
 * @module @sxzl798/agenthub
 */

import { type Context } from '@deepseek-ai/cordis'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { RegistryService, SCHEMA_VERSION, type Project } from './registry.ts'

export const name = 'agenthub'

export const version = '0.2.0'

/** We depend on `commands` (for slash commands) and provide `agenthub.registry`. */
export const inject = ['commands'] as const

/** Pulled in by other agenthub-* plugins once we land them. */
declare module '@deepseek-ai/cordis' {
  interface Context {
    'agenthub.registry': RegistryService
  }
}

/** Slash-command handler factory: lists projects as a fixed-width table. */
async function handleList(invocation: CommandInvocation): Promise<CommandResult> {
  const args = invocation.rawInput.trim().split(/\s+/).filter(Boolean)
  if (args.length > 0) {
    return { kind: 'error', text: 'Usage: /agenthub list (no arguments)' }
  }
  const fs = await import('node:fs/promises')
  const registry = RegistryService
  const hubDir = registry.defaultHubDir()
  const reg = new registry(JSON.parse('{}'), { hubDir } as any) // unused; real one comes via ctx
  // The real access goes through ctx below; this branch is unreachable.
  void fs
  return { kind: 'error', text: 'unreachable' }
}

/** Build the slash command handler that uses ctx.agenthub.registry. */
function makeHandlers(getRegistry: () => RegistryService) {
  return {
    async list(_inv: CommandInvocation): Promise<CommandResult> {
      const projects = await getRegistry().list()
      const names = Object.keys(projects).sort()
      if (names.length === 0) {
        return { kind: 'success', text: 'No projects registered.' }
      }
      const lines = [`agenthub v${version} — ${names.length} project(s)`]
      lines.push('NAME'.padEnd(20) + 'TYPE'.padEnd(14) + 'STATUS'.padEnd(12) + 'PATH')
      lines.push('-'.repeat(70))
      for (const n of names) {
        const p = projects[n]
        lines.push(
          n.padEnd(20) +
            (p.type || '?').padEnd(14) +
            (p.status || '?').padEnd(12) +
            p.path,
        )
      }
      return { kind: 'success', text: lines.join('\n') }
    },

    async show(_inv: CommandInvocation, name?: string): Promise<CommandResult> {
      if (!name) return { kind: 'error', text: 'Usage: /agenthub show <name>' }
      const project = await getRegistry().show(name)
      if (!project) {
        return { kind: 'error', text: `project '${name}' is not registered` }
      }
      return {
        kind: 'success',
        text:
          `${name}\n` +
          `  path:     ${project.path}\n` +
          `  type:     ${project.type}\n` +
          `  status:   ${project.status}\n` +
          `  added:    ${project.added}\n` +
          `  tags:     ${(project.tags || []).join(', ')}\n` +
          `  bundles:  ${(project.bundles || []).join(', ')}\n` +
          (project.note ? `  note:     ${project.note}\n` : ''),
      }
    },

    async add(_inv: CommandInvocation, path?: string): Promise<CommandResult> {
      if (!path) {
        return {
          kind: 'error',
          text: 'Usage: /agenthub add <path> [--name <name>] [--type <type>] [--tags t1,t2]',
        }
      }
      const fs = await import('node:fs/promises')
      try {
        const stat = await fs.stat(path)
        if (!stat.isDirectory()) {
          return { kind: 'error', text: `not a directory: ${path}` }
        }
      } catch {
        return { kind: 'error', text: `path does not exist: ${path}` }
      }
      const name = path.split('/').filter(Boolean).pop() || 'unnamed'
      const today = new Date().toISOString().slice(0, 10)
      const project: Project = {
        path,
        type: 'generic',
        tags: [],
        status: 'new',
        added: today,
        bundles: [],
      }
      try {
        await getRegistry().add(name, project)
        return { kind: 'success', text: `✓ registered '${name}' → ${path}` }
      } catch (err) {
        return { kind: 'error', text: (err as Error).message }
      }
    },

    async remove(_inv: CommandInvocation, name?: string): Promise<CommandResult> {
      if (!name) return { kind: 'error', text: 'Usage: /agenthub remove <name>' }
      try {
        await getRegistry().remove(name)
        return { kind: 'success', text: `✓ removed '${name}'` }
      } catch (err) {
        return { kind: 'error', text: (err as Error).message }
      }
    },
  }
}

/**
 * Plugin entry: dsh invokes this once after resolving our inject deps.
 * Mounts the RegistryService on ctx.agenthub.registry and registers four
 * `/agenthub <subcmd>` slash commands.
 */
export function apply(ctx: Context): void {
  // Boot trace (Phase 0 carryover): the line tells us we loaded even when
  // no agent interaction runs.
  // eslint-disable-next-line no-console
  console.log(`[agenthub v${version}] apply() — schema v${SCHEMA_VERSION}, hub=${RegistryService.defaultHubDir()}`)

  const hubDir = RegistryService.defaultHubDir()
  // Service constructor registers itself on ctx under 'agenthub.registry'.
  // No additional provide() needed.
  const registry = new RegistryService(ctx, { hubDir })

  // Bind after the service exists so handlers always see a live registry.
  const handlers = makeHandlers(() => registry)
  const cmd = (name: string, description: string) =>
    ctx.commands.register({
      definitionId: CommandDefinitionId(`@sxzl798/agenthub/${name}`),
      name: 'agenthub',
      description,
      handler: (inv: CommandInvocation) => {
        const args = inv.rawInput.trim().split(/\s+/).filter(Boolean)
        const sub = args[0]
        const rest = args.slice(1)
        switch (sub) {
          case 'list': return handlers.list(inv)
          case 'show': return handlers.show(inv, rest[0])
          case 'add': return handlers.add(inv, rest[0])
          case 'remove': return handlers.remove(inv, rest[0])
          default:
            return {
              kind: 'error' as const,
              text: `unknown subcommand '${sub}'. Usage: /agenthub <list|show|add|remove>`,
            }
        }
      },
    })

  ctx.effect(function* () {
    yield cmd('agenthub', `AgentHub v${version} — list/show/add/remove projects in ~/AgentHub/projects.json.`)
  }, 'agenthub command lifecycle')

  // keep eslint quiet about unused helper
  void handleList
}
