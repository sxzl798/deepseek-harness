/**
 * AgentHub — Phase 1.B entry. Mounts the registry and skills services and
 * registers one `/agenthub` slash command that dispatches on its first
 * argument.
 *
 * Slash-command surface (v0.3.0):
 *   /agenthub list                  — list registered projects
 *   /agenthub show <name>           — show one project's metadata
 *   /agenthub add <path>            — register a new project
 *   /agenthub remove <name>         — unregister a project
 *   /agenthub skills list           — list hub skills with descriptions
 *   /agenthub skills show <name>    — show one skill's full body
 *   /agenthub doctor [name|all]     — run agent-portable compliance checks
 *
 * @module @sxzl798/agenthub
 */

import { type Context } from '@deepseek-ai/cordis'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { RegistryService, SCHEMA_VERSION, type Project } from './registry.ts'
import { SkillsService, type Skill } from './skills.ts'
import { DoctorService, type DoctorReport } from './doctor.ts'
import { registerWebRoutes } from './web.ts'
import { SessionRecorder, type SessionRecord } from './sessions.ts'

export const name = 'agenthub'

export const version = '0.6.0'

/** We depend on `commands` and `webServer`; we provide the three services. */
export const inject = ['commands', 'webServer'] as const

/** Pulled in by other agenthub-* plugins once we land them. */
declare module '@deepseek-ai/cordis' {
  interface Context {
    'agenthub.registry': RegistryService
    'agenthub.skills': SkillsService
    'agenthub.doctor': DoctorService
  }
}

/* ------------------------------------------------------------------------- */
/*  Handlers                                                                */
/* ------------------------------------------------------------------------- */

type RegistryHandlers = ReturnType<typeof makeRegistryHandlers>
type SkillHandlers = ReturnType<typeof makeSkillHandlers>
type DoctorHandlers = ReturnType<typeof makeDoctorHandlers>

function makeRegistryHandlers(getRegistry: () => RegistryService) {
  return {
    async list(): Promise<CommandResult> {
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

    async show(name?: string): Promise<CommandResult> {
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

    async add(path?: string): Promise<CommandResult> {
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

    async remove(name?: string): Promise<CommandResult> {
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

function makeSkillHandlers(getSkills: () => SkillsService) {
  return {
    async list(): Promise<CommandResult> {
      const table = await getSkills().summaryTable()
      return { kind: 'success', text: table }
    },

    async show(name?: string): Promise<CommandResult> {
      if (!name) {
        return { kind: 'error', text: 'Usage: /agenthub skills show <name>' }
      }
      const skill: Skill | null = await getSkills().show(name)
      if (!skill) {
        return { kind: 'error', text: `skill '${name}' not found in hub` }
      }
      return {
        kind: 'success',
        text:
          `${skill.name}\n` +
          `  description: ${skill.description}\n` +
          (skill.whenToUse ? `  whenToUse:   ${skill.whenToUse}\n` : '') +
          `  file:        ${skill.filePath}\n` +
          `  updated:     ${new Date(skill.mtimeMs).toISOString()}\n\n` +
          '---\n\n' +
          skill.body,
      }
    },
  }
}

function makeDoctorHandlers(
  getRegistry: () => RegistryService,
  getDoctor: () => DoctorService,
) {
  async function runOne(name: string): Promise<CommandResult> {
    const project = await getRegistry().show(name)
    if (!project) return { kind: 'error', text: `project '${name}' is not registered` }
    const report = await getDoctor().check(project.path)
    return { kind: 'success', text: DoctorService.formatReport(report) }
  }

  return {
    async run(target?: string): Promise<CommandResult> {
      const registry = getRegistry()
      const doctor = getDoctor()

      if (!target || target === 'all') {
        const projects = await registry.list()
        const names = Object.keys(projects).sort()
        if (names.length === 0) {
          return { kind: 'success', text: 'No projects registered.' }
        }
        const lines: string[] = [`Doctor all (${names.length} project(s))`]
        let totalPassed = 0
        let totalWarned = 0
        let totalFailed = 0
        for (const n of names) {
          const project = projects[n]
          const report = await doctor.check(project.path)
          const s = `${report.passed}p ${report.warned}w ${report.failed}f`
          lines.push(`  ${n.padEnd(20)} ${s}`)
          totalPassed += report.passed
          totalWarned += report.warned
          totalFailed += report.failed
        }
        lines.push('')
        lines.push(`Totals: ${totalPassed} passed, ${totalWarned} warnings, ${totalFailed} failures`)
        return { kind: 'success', text: lines.join('\n') }
      }

      return runOne(target)
    },
  }
}

/* ------------------------------------------------------------------------- */
/*  Plugin entry                                                             */
/* ------------------------------------------------------------------------- */

/**
 * Plugin entry: dsh invokes this once after resolving our inject deps.
 * Mounts the RegistryService + SkillsService on the cordis context, then
 * registers one `/agenthub` slash command that dispatches on subcommand.
 */
export function apply(ctx: Context): void {
  const hubDir = RegistryService.defaultHubDir()
  // Service constructors auto-register under their declared ctx key.
  const registry = new RegistryService(ctx, { hubDir })
  const skills = new SkillsService(ctx, { hubDir })

  // eslint-disable-next-line no-console
  console.log(
    `[agenthub v${version}] apply() — schema v${SCHEMA_VERSION}, hub=${hubDir}, skills=${skills.skillsDir}`,
  )

  const regHandlers = makeRegistryHandlers(() => registry)
  const skillHandlers = makeSkillHandlers(() => skills)
  const doctor = new DoctorService(ctx)
  const doctorHandlers = makeDoctorHandlers(() => registry, () => doctor)
  const sessions = new SessionRecorder(hubDir)

  ctx.effect(function* () {
    yield ctx.commands.register({
      definitionId: CommandDefinitionId('@sxzl798/agenthub'),
      name: 'agenthub',
      description:
        `AgentHub v${version} — list/show/add/remove projects or list/show skills. ` +
        'Examples: /agenthub list | /agenthub show <name> | /agenthub session 10',
      handler: async (inv: CommandInvocation): Promise<CommandResult> => {
        const tokens = inv.rawInput.trim().split(/\s+/).filter(Boolean)
        const head = tokens[0]
        const rest = tokens.slice(1)

        // Special case: read the session log itself (no recursive logging).
        if (head === 'session') {
          const n = Number(rest[0] ?? '10')
          const limit = Number.isFinite(n) && n > 0 && n <= 100 ? Math.floor(n) : 10
          const records = await sessions.tail(limit)
          return { kind: 'success', text: SessionRecorder.formatRecords(records) }
        }

        let result: CommandResult
        try {
          if (head === 'skills') {
            const sub = rest[0]
            if (!sub || sub === 'list') result = await skillHandlers.list()
            else if (sub === 'show') result = await skillHandlers.show(rest[1])
            else result = {
              kind: 'error' as const,
              text: `unknown skills subcommand '${sub}'. Use: /agenthub skills <list|show>`,
            }
          } else if (head === 'doctor') {
            result = await doctorHandlers.run(rest[0])
          } else {
            switch (head) {
              case 'list': result = await regHandlers.list(); break
              case 'show': result = await regHandlers.show(rest[0]); break
              case 'add': result = await regHandlers.add(rest[0]); break
              case 'remove': result = await regHandlers.remove(rest[0]); break
              default: result = {
                kind: 'error' as const,
                text: `unknown subcommand '${head ?? ''}'. Use: /agenthub <list|show|add|remove|skills|doctor|session>`,
              }
            }
          }
        } catch (err) {
          result = { kind: 'error', text: (err as Error).message }
        }

        // Persist every invocation to the session log. We log the FIRST
        // line of the response so a long table doesn't bloat the JSONL.
        const firstLine = result.text.split('\n', 1)[0] ?? ''
        await sessions.append(
          SessionRecorder.makeRecord(inv.rawInput, result.kind, firstLine),
        ).catch((err) => {
          // eslint-disable-next-line no-console
          console.warn(`[agenthub] session log append failed: ${(err as Error).message}`)
        })

        return result
      },
    })
  }, 'agenthub command lifecycle')

  // v0.5.0: mount REST endpoints on the dsh web server.
  registerWebRoutes(ctx, registry, skills, doctor)
}