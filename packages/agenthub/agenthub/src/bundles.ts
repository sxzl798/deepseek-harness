/**
 * AgentHub bundles — replaces ~/AgentHub/bundles/ management.
 *
 * Each bundle is a directory under ~/AgentHub/bundles/<name>/ containing
 * a `bundle.yaml`. We parse the fields we already use in the bash dsh
 * (`name`, `description`, `applies_to`, `skills`, `prompt_prefix`); other
 * fields pass through as opaque keys for forward compatibility.
 *
 * Service `ctx.agenthub.bundles` exposes the catalog. v0.7.0 is
 * read-only; apply-to-project lands in v1.0.0 alongside the upstream PR
 * so we don't ship a half-implemented writer that could rewrite a
 * project's skill directory without operator intent.
 * @module @sxzl798/agenthub/bundles
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

export interface BundleAppliesTo {
  type?: string
  tags_includes?: string[]
  tags_excludes?: string[]
}

export interface Bundle {
  /** Bundle name (matches directory basename). */
  name: string
  /** Short description. */
  description: string
  /** Filter that says which projects this bundle matches. */
  applies_to?: BundleAppliesTo
  /** Skills that this bundle brings into a project. */
  skills: string[]
  /** Prompt prefix injected when this bundle is active. */
  prompt_prefix: string
  /** Any extra keys from the yaml we don't interpret. */
  extras: Record<string, unknown>
  /** Absolute path to the bundle directory. */
  dir: string
}

export interface BundleConfig {
  hubDir: string
}

/**
 * Parse the tiny subset of YAML we need. Multi-line scalars (folded `>` /
 * literal `|`) are supported for `prompt_prefix` because that's how the
 * existing ~/AgentHub/bundles files are written. Other complex features
 * (anchors, type tags) are intentionally rejected.
 */
function parseBundleYaml(raw: string): Record<string, unknown> {
  const lines = raw.split(/\r?\n/)
  const root: Record<string, unknown> = {}
  const stack: Array<{ indent: number; container: Record<string, unknown> | unknown[] }> = [
    { indent: -1, container: root },
  ]
  let pendingBlockKey: string | null = null
  let pendingBlockIndent = -1
  let pendingBlockLines: string[] = []
  let pendingBlockMode: 'folded' | 'literal' | null = null

  const flushBlock = (): void => {
    if (pendingBlockKey === null) return
    const value =
      pendingBlockMode === 'folded'
        ? pendingBlockLines.join(' ').trim()
        : pendingBlockLines.join('\n')
    const top = stack[stack.length - 1]
    if (top && typeof top.container === 'object' && !Array.isArray(top.container)) {
      ;(top.container as Record<string, unknown>)[pendingBlockKey] = value
    }
    pendingBlockKey = null
    pendingBlockMode = null
    pendingBlockLines = []
  }

  // Set `value` on `top.container` and possibly push a new list frame.
  const assign = (key: string, value: string, indent: number): void => {
    const top = stack[stack.length - 1]
    if (value === '' || value === '|' || value === '>') {
      // start a list under this key
      const arr: unknown[] = []
      if (top && typeof top.container === 'object' && !Array.isArray(top.container)) {
        ;(top.container as Record<string, unknown>)[key] = arr
      }
      stack.push({ indent, container: arr })
      return
    }
    if (top && typeof top.container === 'object' && !Array.isArray(top.container)) {
      ;(top.container as Record<string, unknown>)[key] = value.replace(/^['"]|['"]$/g, '')
    }
  }

  for (const rawLine of lines) {
    if (rawLine.trim() === '' || rawLine.trimStart().startsWith('#')) {
      // Block-scalar continuation can include blank lines as content
      if (pendingBlockKey !== null) {
        pendingBlockLines.push('')
      }
      continue
    }

    // List item: `- value`
    const listMatch = rawLine.match(/^(\s*)-\s+(.*)$/)
    if (listMatch) {
      flushBlock()
      const [, indentStr, value] = listMatch
      const indent = indentStr.length
      // Pop stack back to list frame
      while (stack.length > 1 && stack[stack.length - 1].indent > indent) stack.pop()
      const top = stack[stack.length - 1]
      // Expect `top.container` to be an array; create one if a mapping
      // frame is on top instead (rare; `key:\n  - item` pattern).
      let arr: unknown[]
      if (Array.isArray(top.container)) {
        arr = top.container
      } else if (typeof top.container === 'object') {
        // We don't know the array key in this rare case; skip.
        continue
      } else {
        continue
      }
      const cleaned = value.replace(/^['"]|['"]$/g, '').trim()
      arr.push(cleaned)
      continue
    }

    // Block-scalar continuation
    if (pendingBlockKey !== null) {
      const indent = rawLine.length - rawLine.trimStart().length
      if (indent > pendingBlockIndent) {
        pendingBlockLines.push(rawLine.trim())
        continue
      }
      flushBlock()
    }

    const m = rawLine.match(/^(\s*)([^:]+?):\s*(.*)$/)
    if (!m) continue
    const [, indentStr, key, rest] = m
    const indent = indentStr.length
    const value = rest.replace(/\s+$/, '')

    // Pop stack back to current indent
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop()

    // Block scalar indicator?
    if (value === '>' || value === '|') {
      pendingBlockKey = key.trim()
      pendingBlockIndent = indent
      pendingBlockMode = value === '>' ? 'folded' : 'literal'
      pendingBlockLines = []
      continue
    }

    assign(key.trim(), value, indent)
  }
  flushBlock()
  return root
}

function toBundle(name: string, dir: string, raw: Record<string, unknown>): Bundle {
  return {
    name,
    description: typeof raw.description === 'string' ? raw.description : '',
    applies_to: typeof raw.applies_to === 'object' ? (raw.applies_to as BundleAppliesTo) : undefined,
    skills: Array.isArray(raw.skills) ? raw.skills.map(String) : [],
    prompt_prefix: typeof raw.prompt_prefix === 'string' ? raw.prompt_prefix : '',
    extras: Object.fromEntries(
      Object.entries(raw).filter(([k]) => !['description', 'applies_to', 'skills', 'prompt_prefix', 'name'].includes(k)),
    ),
    dir,
  }
}

/**
 * Bundles registry service. Read-only for v0.7.0.
 */
export class BundlesService extends Service {
  private hubDir: string

  constructor(ctx: Context, config: BundleConfig) {
    super(ctx, 'agenthub.bundles')
    this.hubDir = config.hubDir
  }

  get dir(): string {
    return join(this.hubDir, 'bundles')
  }

  /** Read every bundle directory. Empty list if bundles/ is missing. */
  async list(): Promise<Bundle[]> {
    let entries: string[]
    try {
      entries = await fs.readdir(this.dir)
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') return []
      throw err
    }
    const bundles: Bundle[] = []
    for (const entry of entries.sort()) {
      const dir = join(this.dir, entry)
      try {
        const stat = await fs.stat(dir)
        if (!stat.isDirectory()) continue
      } catch {
        continue
      }
      const yamlPath = join(dir, 'bundle.yaml')
      let raw: string
      try {
        raw = await fs.readFile(yamlPath, 'utf8')
      } catch {
        continue
      }
      const parsed = parseBundleYaml(raw)
      bundles.push(toBundle(entry, dir, parsed))
    }
    return bundles
  }

  async get(name: string): Promise<Bundle | null> {
    const all = await this.list()
    return all.find((b) => b.name === name) ?? null
  }

  /** Format one bundle as YAML for display. */
  static format(b: Bundle): string {
    const lines: string[] = []
    lines.push(`name: ${b.name}`)
    if (b.description) lines.push(`description: ${b.description}`)
    if (b.skills.length) lines.push(`skills: ${b.skills.join(', ')}`)
    if (b.prompt_prefix) {
      lines.push('prompt_prefix: |')
      for (const ln of b.prompt_prefix.split('\n')) lines.push(`  ${ln}`)
    }
    return lines.join('\n')
  }

  /** Render a one-screen summary. */
  async summary(): Promise<string> {
    const list = await this.list()
    if (list.length === 0) return 'No bundles registered.'
    const lines: string[] = [`${list.length} bundle(s)`]
    lines.push('NAME'.padEnd(24) + 'SKILLS'.padEnd(20) + 'DESCRIPTION')
    lines.push('-'.repeat(80))
    for (const b of list) {
      const desc = b.description.length > 40 ? b.description.slice(0, 37) + '...' : b.description
      lines.push(`${b.name.padEnd(24)}${(b.skills.join(',') || '-').padEnd(20)}${desc}`)
    }
    return lines.join('\n')
  }
}