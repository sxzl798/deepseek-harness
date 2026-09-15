/**
 * AgentHub profiles — replaces ~/AgentHub/profiles/ management.
 *
 * Each profile is one file under ~/AgentHub/profiles/<name>.<ext>, where
 * <ext> is `.md` (markdown with a "## Agent prompt prefix" section) or
 * `.yaml` / `.yml` (raw key: value). The agent prompt prefix is the
 * first paragraph after the `## Agent prompt prefix` header (markdown)
 * or the `prompt:` field (yaml).
 *
 * Service `ctx.agenthub.profiles` exposes the catalog and the active
 * profile. Active state lives in `~/AgentHub/.active_profile` (shared
 * with the bash dsh).
 * @module @sxzl798/agenthub/profiles
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import { existsSync, promises as fs } from 'node:fs'
import { join, basename, extname } from 'node:path'

export interface ProfileSummary {
  name: string
  path: string
  /** Length of the body in characters (cheap, lazy). */
  bytes: number
}

export interface ProfileConfig {
  hubDir: string
  /** Optional override; defaults to ~/AgentHub/.active_profile. */
  activeFile?: string
}

const DEFAULT_PROFILE = 'focus'

/** Strip a `.yaml`/`.yml`/`.md` suffix from a profile file's basename. */
function stripExt(name: string): string {
  const ext = extname(name)
  if (ext === '.yaml' || ext === '.yml' || ext === '.md' || ext === '.txt') {
    return basename(name, ext)
  }
  return basename(name)
}

/** Read the first line after `## Agent prompt prefix` in markdown body. */
function extractMarkdownPrefix(body: string): string {
  const marker = /##\s*Agent prompt prefix/i
  const idx = body.search(marker)
  if (idx < 0) return ''
  const after = body.slice(idx).split('\n').slice(1) // drop the heading line
  // Skip blank lines and "> " quote markers; collect contiguous text
  const lines: string[] = []
  for (const raw of after) {
    const line = raw.replace(/^>\s?/, '').trim()
    if (line.length === 0) {
      if (lines.length > 0) break // first blank ends the paragraph
      continue
    }
    lines.push(line)
  }
  return lines.join(' ').trim()
}

/** Parse a tiny subset of yaml (key: value) for prompt: fields. */
function extractYamlPrefix(body: string): string {
  for (const raw of body.split('\n')) {
    const m = raw.match(/^prompt(?:\s*prefix)?\s*:\s*(.*)$/i)
    if (m && m[1]) {
      return m[1].replace(/^['"]|['"]$/g, '').trim()
    }
  }
  return ''
}

/**
 * Profiles registry service. Read + activate operations are the focus
 * for v0.7.0; mutations (`set`) live alongside for parity with the
 * bash `dsh profile` command.
 */
export class ProfilesService extends Service {
  private hubDir: string
  private activeFile: string

  constructor(ctx: Context, config: ProfileConfig) {
    super(ctx, 'agenthub.profiles')
    this.hubDir = config.hubDir
    this.activeFile = config.activeFile || join(config.hubDir, '.active_profile')
  }

  /** Path to the canonical profiles directory. */
  get dir(): string {
    return join(this.hubDir, 'profiles')
  }

  /** List every profile file. Returns names sorted alphabetically. */
  async list(): Promise<ProfileSummary[]> {
    let entries: string[]
    try {
      entries = await fs.readdir(this.dir)
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') return []
      throw err
    }
    const allowed = new Set(['.yaml', '.yml', '.md', '.txt'])
    const out: ProfileSummary[] = []
    for (const entry of entries.sort()) {
      const ext = extname(entry)
      if (!allowed.has(ext)) continue
      const path = join(this.dir, entry)
      const stat = await fs.stat(path)
      out.push({ name: stripExt(entry), path, bytes: stat.size })
    }
    return out
  }

  /** Read the full body of one profile. Returns null if not found. */
  async get(name: string): Promise<string | null> {
    for (const ext of ['.md', '.yaml', '.yml', '.txt']) {
      const path = join(this.dir, `${name}${ext}`)
      try {
        return await fs.readFile(path, 'utf8')
      } catch (err) {
        if ((err as { code?: string }).code !== 'ENOENT') throw err
      }
    }
    return null
  }

  /** Extract the agent prompt prefix from a profile body. */
  async getPromptPrefix(name: string): Promise<string> {
    const body = await this.get(name)
    if (!body) return ''
    const ext = extname(this.findPath(name) ?? '.md')
    if (ext === '.yaml' || ext === '.yml') return extractYamlPrefix(body)
    return extractMarkdownPrefix(body)
  }

  /** Find the path for one profile (for extension detection). */
  private findPath(name: string): string | null {
    for (const ext of ['.md', '.yaml', '.yml', '.txt']) {
      const path = join(this.dir, `${name}${ext}`)
      if (existsSync(path)) return path
    }
    return null
  }

  /** Currently active profile name. Falls back to 'focus' if unset. */
  async active(): Promise<string> {
    try {
      const raw = (await fs.readFile(this.activeFile, 'utf8')).trim()
      return raw || DEFAULT_PROFILE
    } catch {
      return DEFAULT_PROFILE
    }
  }

  /** Persist a new active profile name. */
  async setActive(name: string): Promise<void> {
    await fs.writeFile(this.activeFile, name, 'utf8')
  }

  /** Render a one-screen summary suitable for a slash command. */
  async summary(): Promise<string> {
    const list = await this.list()
    const active = await this.active()
    const lines: string[] = [`${list.length} profile(s), active: ${active}`]
    lines.push('NAME'.padEnd(20) + 'BYTES')
    lines.push('-'.repeat(40))
    for (const p of list) {
      const mark = p.name === active ? '✓' : ' '
      lines.push(`${mark} ${p.name.padEnd(18)} ${p.bytes}b`)
    }
    return lines.join('\n')
  }
}