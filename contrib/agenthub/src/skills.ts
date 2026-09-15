/**
 * AgentHub skills — replaces ~/AgentHub/skills/ management.
 *
 * Reads the canonical skills directory (one folder per skill, each
 * containing a `SKILL.md` with YAML frontmatter). The frontmatter must
 * expose `name` and `description`; the body is the markdown instruction
 * the AI agent reads when the skill is loaded.
 *
 * Service `ctx.agenthub.skills` provides read access; mutations live in
 * the existing bash `~/AgentHub/scripts/import.sh` and `sync.sh` so the
 * dsh plugin stays a thin client over the on-disk layout.
 * @module @sxzl798/agenthub/skills
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import path from 'node:path'

export interface Skill {
  /** Skill folder name under ~/AgentHub/skills/. Also the skill identifier. */
  name: string
  /** Parsed from frontmatter. Falls back to folder name if absent. */
  description: string
  /** Optional frontmatter field. */
  whenToUse?: string
  /** Absolute path to the SKILL.md file. */
  filePath: string
  /** Directory the skill lives in (parent of SKILL.md). */
  dirPath: string
  /** File modification time (ms epoch). Useful for "last updated" UIs. */
  mtimeMs: number
  /** Full markdown body (frontmatter stripped). */
  body: string
}

export interface SkillsConfig {
  hubDir: string
}

/** Result of `parseFrontmatter`. Caller decides what to do with missing fields. */
interface ParsedFrontmatter {
  description?: string
  whenToUse?: string
  /** All other frontmatter fields, preserved for callers that need them. */
  extra: Record<string, string>
  body: string
}

/**
 * Parse the minimal YAML frontmatter the dsh skill spec requires
 * (`name:` + `description:`). We deliberately do not pull in a YAML
 * library — only these two fields matter for display, and the body
 * passes through unchanged.
 */
function parseFrontmatter(raw: string): ParsedFrontmatter {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) {
    return { extra: {}, body: raw }
  }
  const [, yamlBlock, body] = match
  const extra: Record<string, string> = {}
  let description: string | undefined
  let whenToUse: string | undefined
  // very small subset: lines of `key: value` (value can be unquoted or "quoted")
  for (const line of yamlBlock.split('\n')) {
    const m = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/)
    if (!m) continue
    const [, key, rawValue] = m
    const value = rawValue.replace(/^['"]|['"]$/g, '').trim()
    if (key === 'description') description = value
    else if (key === 'whenToUse') whenToUse = value
    else extra[key] = value
  }
  return { description, whenToUse, extra, body: body.trimStart() }
}

/**
 * Skills registry service. Lists, reads, and (optionally) writes skill
 * directories under the hub's `skills/` folder. Mutations are
 * intentionally conservative: a skill in the hub is the source of truth,
 * so add/remove only touch files we can fully round-trip.
 */
export class SkillsService extends Service {
  private hubDir: string

  constructor(ctx: Context, config: SkillsConfig) {
    super(ctx, 'agenthub.skills')
    this.hubDir = config.hubDir
  }

  /** Path to the canonical skills directory. */
  get skillsDir(): string {
    return path.join(this.hubDir, 'skills')
  }

  /** Default hub location, mirroring RegistryService.defaultHubDir(). */
  static defaultHubDir(): string {
    return process.env.AGENTHUB_DIR || `${process.env.HOME || ''}/AgentHub`
  }

  /** Static factory so the index plugin can wire up the service the same way. */
  static fromDefault(ctx: Context): SkillsService {
    return new SkillsService(ctx, { hubDir: SkillsService.defaultHubDir() })
  }

  /**
   * Enumerate every skill directory in the hub. Missing or empty `skills/`
   * is not an error: returns an empty array. Each directory must contain
   * a `SKILL.md` to be considered a valid skill; directories without one
   * are skipped (with a console warning) so a half-installed skill doesn't
   * crash the agent.
   */
  async list(): Promise<Skill[]> {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')

    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(this.skillsDir, { withFileTypes: true })
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') return []
      throw err
    }

    const skills: Skill[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dirPath = path.join(this.skillsDir, entry.name)
      const filePath = path.join(dirPath, 'SKILL.md')
      let stat: import('node:fs').Stats
      try {
        stat = await fs.stat(filePath)
      } catch {
        // eslint-disable-next-line no-console
        console.warn(`[agenthub.skills] skip ${entry.name}: SKILL.md missing`)
        continue
      }
      const raw = await fs.readFile(filePath, 'utf8')
      const fm = parseFrontmatter(raw)
      skills.push({
        name: entry.name,
        description: fm.description ?? `(no description for ${entry.name})`,
        whenToUse: fm.whenToUse,
        filePath,
        dirPath,
        mtimeMs: stat.mtimeMs,
        body: fm.body,
      })
    }
    skills.sort((a, b) => a.name.localeCompare(b.name))
    return skills
  }

  async show(name: string): Promise<Skill | null> {
    const skills = await this.list()
    return skills.find((s) => s.name === name) ?? null
  }

  /** Format `list()` as a fixed-width summary suitable for a slash command. */
  async summaryTable(): Promise<string> {
    const skills = await this.list()
    if (skills.length === 0) return 'No skills registered.'
    const lines = [`${skills.length} skill(s)`]
    lines.push('NAME'.padEnd(24) + 'DESCRIPTION')
    lines.push('-'.repeat(80))
    for (const s of skills) {
      const desc = s.description.length > 52 ? s.description.slice(0, 49) + '...' : s.description
      lines.push(s.name.padEnd(24) + desc)
    }
    return lines.join('\n')
  }
}