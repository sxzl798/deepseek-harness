/**
 * AgentHub registry — replaces ~/AgentHub/projects.json management.
 *
 * Service `ctx.agenthub.registry` owns the canonical project registry file.
 * All mutators write through `RegistryService.write()` with a single shared
 * JSON shape (matches the schema produced by the bash `dsh add` tool so the
 * two stay interoperable).
 * @module @sxzl798/agenthub/registry
 */

import { Service, type Context } from '@deepseek-ai/cordis'

export const SCHEMA_VERSION = 1

export interface Project {
  path: string
  type: string
  tags: string[]
  status: string
  added: string
  note?: string
  bundles?: string[]
}

export interface RegistryFile {
  schema_version: number
  default_profile?: string
  projects: Record<string, Project>
}

export interface RegistryConfig {
  /** Path to ~/AgentHub (or AGENTHUB_DIR override). */
  hubDir: string
}

/**
 * Single-source-of-truth for project registry. All access goes through this
 * service so future enhancements (file locking, schema migration, RPC
 * backend) only need to change one place.
 */
export class RegistryService extends Service {
  private hubDir: string

  constructor(ctx: Context, config: RegistryConfig) {
    super(ctx, 'agenthub.registry')
    this.hubDir = config.hubDir
  }

  private get filePath(): string {
    return `${this.hubDir}/projects.json`
  }

  /** Resolve the hub directory from the current process env. */
  static defaultHubDir(): string {
    return process.env.AGENTHUB_DIR || `${process.env.HOME || ''}/AgentHub`
  }

  /**
   * Read the registry file. Missing file yields an empty registry with the
   * current schema version; corrupt JSON is a real error.
   */
  async read(): Promise<RegistryFile> {
    const fs = await import('node:fs/promises')
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw)
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        typeof parsed.projects !== 'object' ||
        parsed.projects === null
      ) {
        throw new Error(`registry file at ${this.filePath} is malformed (missing projects)`)
      }
      // Migrate older schemas forward.
      parsed.schema_version = parsed.schema_version || SCHEMA_VERSION
      return parsed as RegistryFile
    } catch (err) {
      if (err && typeof err === 'object' && (err as { code?: string }).code === 'ENOENT') {
        return { schema_version: SCHEMA_VERSION, projects: {} }
      }
      throw err
    }
  }

  /** Atomically write the registry file (write-then-rename). */
  async write(data: RegistryFile): Promise<void> {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    await fs.mkdir(this.hubDir, { recursive: true })
    const tmp = `${this.filePath}.tmp.${process.pid}`
    await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n')
    await fs.rename(tmp, this.filePath)
    // touch not strictly needed; rename bumps mtime
    void path
  }

  /** Return all registered projects as a plain object. */
  async list(): Promise<Record<string, Project>> {
    return (await this.read()).projects
  }

  async show(name: string): Promise<Project | null> {
    const r = await this.read()
    return r.projects[name] || null
  }

  /** Compute the absolute filesystem path for a registered project. */
  async goPath(name: string): Promise<string | null> {
    const p = await this.show(name)
    return p ? p.path : null
  }

  /** Register a new project. Throws if the name already exists. */
  async add(name: string, project: Project): Promise<void> {
    const r = await this.read()
    if (r.projects[name]) {
      throw new Error(`project '${name}' is already registered`)
    }
    r.projects[name] = project
    await this.write(r)
  }

  /** Unregister an existing project. Throws if the name is unknown. */
  async remove(name: string): Promise<void> {
    const r = await this.read()
    if (!r.projects[name]) {
      throw new Error(`project '${name}' is not registered`)
    }
    delete r.projects[name]
    await this.write(r)
  }
}
