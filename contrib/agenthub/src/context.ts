/**
 * AgentHub context — find which registered project a cwd belongs to and
 * emit a one-screen handoff for the AI agent that just entered the dir.
 *
 * Three steps in `current(cwd)`:
 *   1. resolve name  — longest-prefix match of cwd against projects.json paths
 *   2. load status   — registry entry + doctor summary + profile
 *   3. read handoff  — docs/HANDOFF.md first ~30 lines (the agent-portable
 *                      convention: "what was I last doing here")
 *
 * The handoff text is plain markdown so any agent (Claude Code / Codex /
 * OpenCode) can read it without parsing.
 * @module @sxzl798/agenthub/context
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import { promises as fs } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { RegistryService, type Project } from './registry.ts'

export interface ContextConfig {
  hubDir: string
  /** Number of Handoff.md lines to include in the output. */
  handoffLines?: number
}

export interface CurrentContext {
  /** Resolved project name, or null if cwd is not inside a registered project. */
  name: string | null
  /** The cwd passed in. */
  cwd: string
  /** Project metadata (only present when name is not null). */
  project?: Project
  /** Doctor summary, if a project matched and a report was run. */
  doctor?: { passed: number; warned: number; failed: number }
  /** Active profile name. */
  activeProfile?: string
  /** First few lines of docs/HANDOFF.md for the project. */
  handoffPreview?: string
  /** Wall-clock ISO timestamp. */
  iso: string
}

/**
 * Find the project whose path is the longest prefix of `cwd`. Returns
 * null when no project contains the cwd (e.g. you're somewhere not
 * registered yet).
 */
function findProjectByCwd(projects: Record<string, Project>, cwd: string): [string, Project] | null {
  let best: [string, Project] | null = null
  for (const [name, info] of Object.entries(projects)) {
    if (!info.path) continue
    const projectAbs = resolve(info.path)
    if (cwd === projectAbs || cwd.startsWith(projectAbs + '/')) {
      if (!best || projectAbs.length > resolve(best[1].path).length) {
        best = [name, info]
      }
    }
  }
  return best
}

export class ContextService extends Service {
  private hubDir: string
  private handoffLines: number

  constructor(ctx: Context, config: ContextConfig) {
    super(ctx, 'agenthub.context')
    this.hubDir = config.hubDir
    this.handoffLines = config.handoffLines ?? 30
  }

  /** Return a CurrentContext for the given directory (default: process cwd). */
  async current(cwd: string = process.cwd()): Promise<CurrentContext> {
    const absCwd = resolve(cwd)
    const result: CurrentContext = {
      name: null,
      cwd: absCwd,
      iso: new Date().toISOString(),
    }
    const ctx = this.ctx as Context
    const registry = ctx['agenthub.registry'] as RegistryService
    const doctor = ctx['agenthub.doctor'] as { check(p: string): Promise<{ passed: number; warned: number; failed: number }> }
    const projects = await registry.list()
    const match = findProjectByCwd(projects, absCwd)
    if (!match) return result
    const [name, project] = match
    result.name = name
    result.project = project

    // Doctor summary (best effort — don't fail the whole handoff).
    try {
      const report = await doctor.check(project.path)
      result.doctor = {
        passed: report.passed,
        warned: report.warned,
        failed: report.failed,
      }
    } catch { /* swallow */ }

    // Active profile (read ~/AgentHub/.active_profile).
    try {
      const activeRaw = (await fs.readFile(resolve(this.hubDir, '.active_profile'), 'utf8')).trim()
      if (activeRaw) result.activeProfile = activeRaw
    } catch { /* no active profile file */ }

    // Handoff preview — read first N lines of docs/HANDOFF.md.
    try {
      const handoffPath = resolve(project.path, 'docs', 'HANDOFF.md')
      const text = await fs.readFile(handoffPath, 'utf8')
      const lines = text.split('\n').slice(0, this.handoffLines)
      result.handoffPreview = lines.join('\n')
    } catch { /* no handoff yet */ }

    return result
  }

  /** Render a context as a markdown block ready to inject into an agent prompt. */
  static formatMarkdown(ctx: CurrentContext): string {
    const lines: string[] = ['<!-- agenthub context: start -->']
    lines.push(`# agenthub context (cwd: ${ctx.cwd})`)
    lines.push('')
    lines.push(`Generated: ${ctx.iso}`)
    lines.push('')
    if (!ctx.name) {
      lines.push('This directory is not inside any agenthub-registered project.')
      lines.push('Register it with: ~/AgentHub/dsh add <path>')
    } else {
      lines.push(`Project: **${ctx.name}**  (type: ${ctx.project?.type ?? '?'}, status: ${ctx.project?.status ?? '?'})`)
      lines.push(`Path:    ${ctx.project?.path}`)
      if (ctx.activeProfile) lines.push(`Profile: ${ctx.activeProfile}`)
      if (ctx.doctor) {
        lines.push(`Doctor:  ${ctx.doctor.passed}p ${ctx.doctor.warned}w ${ctx.doctor.failed}f`)
      }
      if (ctx.handoffPreview) {
        lines.push('')
        lines.push('## Last handoff (docs/HANDOFF.md preview)')
        lines.push('```')
        lines.push(ctx.handoffPreview)
        lines.push('```')
      } else {
        lines.push('')
        lines.push('No HANDOFF.md yet — create docs/HANDOFF.md to record the next session state.')
      }
    }
    lines.push('<!-- agenthub context: end -->')
    return lines.join('\n')
  }
}