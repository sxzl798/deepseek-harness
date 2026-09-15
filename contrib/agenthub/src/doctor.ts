/**
 * AgentHub doctor — replaces ~/AgentHub/scripts/agent-doctor.sh.
 *
 * Runs a battery of "is this project agent-portable?" checks against a
 * project directory and yields a structured report the slash command can
 * format. The original bash script has 10 checks; we start with the most
 * useful ones (AGENTS.md, CLAUDE.md, docs/HANDOFF.md, .agentignore,
 * .githooks/pre-commit, .opencode/skills symlink).
 *
 * Service `ctx.agenthub.doctor` exposes the report; mutations (running
 * `dsh fix`) stay in the bash script for now.
 * @module @sxzl798/agenthub/doctor
 */

import { Service, type Context } from '@deepseek-ai/cordis'

export type CheckStatus = 'pass' | 'warn' | 'fail'

export interface Check {
  /** Human-friendly name shown in the report. */
  name: string
  /** Short identifier (e.g. 'agents_md'). */
  id: string
  status: CheckStatus
  /** Optional hint shown beside failures. */
  hint?: string
}

export interface DoctorReport {
  /** Project directory the report is for. */
  path: string
  /** True when the path doesn't exist or isn't a directory. */
  missing: boolean
  /** Per-check status; missing projects return an empty array. */
  checks: Check[]
  /** Aggregate summary, derived from `checks`. */
  passed: number
  warned: number
  failed: number
}

export interface DoctorConfig {
  /** Project directory to inspect. */
  path: string
}

/** One check's verdict. */
async function exists(path: string): Promise<boolean> {
  try {
    const fs = await import('node:fs/promises')
    await fs.stat(path)
    return true
  } catch {
    return false
  }
}

/** Same as exists(), but also asserts it's a directory. */
async function isDir(path: string): Promise<boolean> {
  try {
    const fs = await import('node:fs/promises')
    const stat = await fs.stat(path)
    return stat.isDirectory()
  } catch {
    return false
  }
}

/** Read a file's first ~maxBytes to keep the report lightweight. */
async function peek(path: string, maxBytes = 16 * 1024): Promise<string> {
  const fs = await import('node:fs/promises')
  try {
    const f = await fs.open(path, 'r')
    try {
      const buf = Buffer.alloc(maxBytes)
      const { bytesRead } = await f.read(buf, 0, maxBytes, 0)
      return buf.subarray(0, bytesRead).toString('utf8')
    } finally {
      await f.close()
    }
  } catch {
    return ''
  }
}

/** DoctorService — run a battery of checks against a project directory. */
export class DoctorService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'agenthub.doctor')
  }

  /**
   * Run every check against the given project path. Returns a report whose
   * `missing: true` short-circuits all other checks (useful when the AI
   * agent asks about a project whose path was deleted).
   */
  async check(path: string): Promise<DoctorReport> {
    const report: DoctorReport = {
      path,
      missing: false,
      checks: [],
      passed: 0,
      warned: 0,
      failed: 0,
    }
    if (!(await isDir(path))) {
      report.missing = true
      report.checks.push({
        id: 'path',
        name: 'project directory exists',
        status: 'fail',
        hint: `${path} is not a directory`,
      })
      report.failed = 1
      return report
    }

    const checks: Check[] = []

    // 1. AGENTS.md exists, lines ≤ 150
    const agentsPath = `${path}/AGENTS.md`
    if (await exists(agentsPath)) {
      const fs = await import('node:fs/promises')
      const content = await fs.readFile(agentsPath, 'utf8')
      const lines = content.split('\n').length
      if (lines > 150) {
        checks.push({
          id: 'agents_md',
          name: 'AGENTS.md present (≤ 150 lines)',
          status: 'warn',
          hint: `${lines} lines; long AGENTS.md bloats agent context`,
        })
      } else {
        checks.push({ id: 'agents_md', name: `AGENTS.md present (${lines} lines)`, status: 'pass' })
      }
    } else {
      checks.push({
        id: 'agents_md',
        name: 'AGENTS.md present',
        status: 'fail',
        hint: 'run `dsh init <path> --from <path> --git` to bootstrap',
      })
    }

    // 2. CLAUDE.md @-imports AGENTS.md
    const claudePath = `${path}/CLAUDE.md`
    if (await exists(claudePath)) {
      const content = await peek(claudePath, 256)
      if (content.includes('@AGENTS.md')) {
        checks.push({ id: 'claude_md', name: 'CLAUDE.md @-imports AGENTS.md', status: 'pass' })
      } else {
        checks.push({
          id: 'claude_md',
          name: 'CLAUDE.md @-imports AGENTS.md',
          status: 'warn',
          hint: 'expected `@AGENTS.md` as first line',
        })
      }
    } else {
      checks.push({
        id: 'claude_md',
        name: 'CLAUDE.md present',
        status: 'warn',
        hint: 'Claude Code users will not see this project',
      })
    }

    // 3. docs/HANDOFF.md exists and was modified within 14 days
    const handoffPath = `${path}/docs/HANDOFF.md`
    if (await exists(handoffPath)) {
      const fs = await import('node:fs/promises')
      const stat = await fs.stat(handoffPath)
      const ageDays = Math.floor((Date.now() - stat.mtimeMs) / 86_400_000)
      if (ageDays > 14) {
        checks.push({
          id: 'handoff_md',
          name: 'docs/HANDOFF.md fresh (≤ 14 days)',
          status: 'warn',
          hint: `${ageDays} day(s) old — refresh with last session's state`,
        })
      } else {
        checks.push({ id: 'handoff_md', name: `docs/HANDOFF.md fresh (${ageDays}d)`, status: 'pass' })
      }
    } else {
      checks.push({
        id: 'handoff_md',
        name: 'docs/HANDOFF.md present',
        status: 'fail',
        hint: 'create `docs/HANDOFF.md` with what was last in progress',
      })
    }

    // 4. .agentignore present
    if (await exists(`${path}/.agentignore`)) {
      checks.push({ id: 'agentignore', name: '.agentignore present', status: 'pass' })
    } else {
      checks.push({
        id: 'agentignore',
        name: '.agentignore present',
        status: 'fail',
        hint: 'missing — agents may read .DS_Store, node_modules, etc.',
      })
    }

    // 5. .githooks/pre-commit exists + executable
    const hookPath = `${path}/.githooks/pre-commit`
    if (await exists(hookPath)) {
      const fs = await import('node:fs/promises')
      const stat = await fs.stat(hookPath)
      if (stat.mode & 0o111) {
        checks.push({ id: 'githooks', name: '.githooks/pre-commit present + executable', status: 'pass' })
      } else {
        checks.push({
          id: 'githooks',
          name: '.githooks/pre-commit present + executable',
          status: 'warn',
          hint: 'file exists but is not executable (chmod +x .githooks/pre-commit)',
        })
      }
    } else {
      checks.push({
        id: 'githooks',
        name: '.githooks/pre-commit present',
        status: 'warn',
        hint: 'HANDOFF.md updates will not be enforced at commit time',
      })
    }

    // 6. .opencode/skills symlink target exists AND is a non-empty directory
    const linkPath = `${path}/.opencode/skills`
    try {
      const fs = await import('node:fs/promises')
      const stat = await fs.lstat(linkPath)
      if (stat.isSymbolicLink()) {
        const target = await fs.readlink(linkPath)
        // Relative symlink targets must be resolved against the symlink's
        // own directory, not the caller's cwd. `fs.realpath` chases the
        // whole chain; we additionally require the resolved path to be a
        // directory with at least one SKILL.md entry so an empty skill
        // placeholder (created by `agent-init`) does not falsely pass.
        const real = await fs.realpath(linkPath).catch(() => '')
        if (!real) {
          checks.push({
            id: 'opencode_link',
            name: '.opencode/skills symlink works',
            status: 'fail',
            hint: `broken symlink → ${target}`,
          })
        } else {
          const realStat = await fs.stat(real)
          if (!realStat.isDirectory()) {
            checks.push({
              id: 'opencode_link',
              name: '.opencode/skills symlink works',
              status: 'fail',
              hint: `target is not a directory: ${real}`,
            })
          } else {
            // Walk one level deep to find SKILL.md (either at root or in a
            // one-level subdirectory). Empty hub placeholder dirs are
            // common right after `agent-init`; fail in that case so the
            // user knows to run `~/AgentHub/scripts/sync.sh`.
            //
            // Note: entry.isDirectory() returns false for symlinks even when
            // their target is a directory, so we use `fs.stat` (which
            // follows symlinks) to test the target's actual kind.
            const entryNames = await fs.readdir(real).catch(() => [])
            let hasSkill = false
            for (const name of entryNames) {
              if (name === 'SKILL.md') {
                try {
                  const s = await fs.stat(`${real}/${name}`)
                  if (s.isFile()) { hasSkill = true; break }
                } catch { /* ignore */ }
                continue
              }
              try {
                const s = await fs.stat(`${real}/${name}`)
                if (s.isDirectory()) {
                  await fs.access(`${real}/${name}/SKILL.md`)
                  hasSkill = true
                  break
                }
              } catch { /* not a skill */ }
            }
            if (!hasSkill) {
              checks.push({
                id: 'opencode_link',
                name: '.opencode/skills symlink works',
                status: 'fail',
                hint: `${real} resolves to an empty directory (no skills)`,
              })
            } else {
              checks.push({
                id: 'opencode_link',
                name: `.opencode/skills symlink works (resolves to ${real})`,
                status: 'pass',
              })
            }
          }
        }
      } else {
        checks.push({
          id: 'opencode_link',
          name: '.opencode/skills symlink works',
          status: 'warn',
          hint: 'exists but is not a symlink',
        })
      }
    } catch {
      checks.push({
        id: 'opencode_link',
        name: '.opencode/skills symlink works',
        status: 'fail',
        hint: 'run `ln -s ../.agents/skills .opencode/skills`',
      })
    }

    // 7. .claude/hooks/stop-check-handoff.sh present
    if (await exists(`${path}/.claude/hooks/stop-check-handoff.sh`)) {
      checks.push({ id: 'claude_stop_hook', name: '.claude/hooks/stop-check-handoff.sh present', status: 'pass' })
    } else {
      checks.push({
        id: 'claude_stop_hook',
        name: '.claude/hooks/stop-check-handoff.sh present',
        status: 'warn',
        hint: 'Claude Code will not remind to update HANDOFF.md on exit',
      })
    }

    report.checks = checks
    for (const c of checks) {
      if (c.status === 'pass') report.passed++
      else if (c.status === 'warn') report.warned++
      else report.failed++
    }
    return report
  }

  /** Format a report as a multi-line string for slash-command output. */
  static formatReport(report: DoctorReport): string {
    const lines: string[] = []
    lines.push(`Doctor for ${report.path}`)
    if (report.missing) {
      lines.push('  project path does not exist')
      return lines.join('\n')
    }
    for (const c of report.checks) {
      const mark = c.status === 'pass' ? '✓' : c.status === 'warn' ? '⚠' : '✗'
      lines.push(`  ${mark} ${c.name}`)
      if (c.hint && c.status !== 'pass') lines.push(`      ${c.hint}`)
    }
    lines.push('')
    lines.push(`Summary: ${report.passed} passed, ${report.warned} warnings, ${report.failed} failures`)
    return lines.join('\n')
  }
}