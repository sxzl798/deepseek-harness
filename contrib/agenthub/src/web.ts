/**
 * AgentHub web — REST endpoint handlers and registration helpers.
 *
 * Each endpoint returns JSON; the dashboard HTML is served by the
 * shipped dsh web composition (no need for a static handler).
 *
 * Routes are mounted under `/agenthub-api/` (NOT `/api/`) because the
 * dsh web framework routes every `/api/**` request through the browser
 * trust fence, which rejects requests without the per-session token.
 * Our endpoints are useful to humans (curl, scripts) and trusted agents
 * alike, so we live outside that namespace.
 *
 * This module exports `registerWebRoutes(ctx, deps)` — a plain function
 * invoked by the plugin's apply(). It does NOT export `name`/`apply`
 * because we don't want the Cordis loader to mount it as a separate
 * plugin (we're part of the same plugin lifecycle as Registry/Skills/Doctor).
 * @module @sxzl798/agenthub/web
 */

import { type Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { RegistryService, type Project } from './registry.ts'
import { SkillsService } from './skills.ts'
import { DoctorService, type DoctorReport } from './doctor.ts'

/** Tiny JSON helper. */
function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8')
    })
    req.on('end', () => {
      try {
        resolve(raw ? (JSON.parse(raw) as T) : ({} as T))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

/**
 * Register every Agenthub web route on the dsh webServer. Called from
 * the main plugin's apply() so we share the same inject contract.
 */
export function registerWebRoutes(
  ctx: Context,
  registry: RegistryService,
  skills: SkillsService,
  doctor: DoctorService,
): void {
  // GET /agenthub-api/projects — list every project with a doctor summary.
  ctx.effect(function* () {
    yield ctx.webServer.register({
      kind: 'exact',
      path: '/agenthub-api/projects',
      handler: async (_req: IncomingMessage, res: ServerResponse) => {
        try {
          const projects = await registry.list()
          const names = Object.keys(projects).sort()
          const enriched: Array<{
            name: string
            info: Project
            doctor?: { passed: number; warned: number; failed: number }
          }> = []
          for (const name of names) {
            const info = projects[name]
            const report = await doctor.check(info.path)
            enriched.push({
              name,
              info,
              doctor: { passed: report.passed, warned: report.warned, failed: report.failed },
            })
          }
          jsonResponse(res, 200, { projects: enriched })
        } catch (err) {
          jsonResponse(res, 500, { error: (err as Error).message })
        }
      },
    })
  }, 'agenthub projects endpoint')

  // GET /agenthub-api/skills
  ctx.effect(function* () {
    yield ctx.webServer.register({
      kind: 'exact',
      path: '/agenthub-api/skills',
      handler: async (_req: IncomingMessage, res: ServerResponse) => {
        try {
          jsonResponse(res, 200, { skills: await skills.list() })
        } catch (err) {
          jsonResponse(res, 500, { error: (err as Error).message })
        }
      },
    })
  }, 'agenthub skills endpoint')

  // GET /agenthub-api/doctor/<name|all>
  ctx.effect(function* () {
    yield ctx.webServer.register({
      kind: 'prefix',
      path: '/agenthub-api/doctor',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url || '/agenthub-api/doctor', 'http://localhost')
        const segments = url.pathname.replace(/^\/agenthub-api\/doctor\/?/, '').split('/').filter(Boolean)
        const target = segments[0]
        try {
          if (!target || target === 'all') {
            const projects = await registry.list()
            const names = Object.keys(projects).sort()
            const reports: Array<{ name: string; report: DoctorReport }> = []
            for (const n of names) {
              reports.push({ name: n, report: await doctor.check(projects[n].path) })
            }
            jsonResponse(res, 200, { reports })
            return
          }
          const project = await registry.show(target)
          if (!project) {
            jsonResponse(res, 404, { error: `project '${target}' is not registered` })
            return
          }
          jsonResponse(res, 200, { report: await doctor.check(project.path) })
        } catch (err) {
          jsonResponse(res, 500, { error: (err as Error).message })
        }
      },
    })
  }, 'agenthub doctor endpoint')

  // GET /agenthub-api/status
  ctx.effect(function* () {
    yield ctx.webServer.register({
      kind: 'exact',
      path: '/agenthub-api/status',
      handler: async (_req: IncomingMessage, res: ServerResponse) => {
        try {
          const projects = await registry.list()
          const list = await skills.list()
          jsonResponse(res, 200, {
            hubDir: skills.skillsDir,
            projectCount: Object.keys(projects).length,
            skillCount: list.length,
            activeProfile: process.env.DSH_ACTIVE_PROFILE || 'default',
          })
        } catch (err) {
          jsonResponse(res, 500, { error: (err as Error).message })
        }
      },
    })
  }, 'agenthub status endpoint')

  // POST /agenthub-api/add + /remove (no auth for v0.5.0).
  ctx.effect(function* () {
    yield ctx.webServer.register({
      kind: 'exact',
      path: '/agenthub-api/add',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        try {
          const body = await readJsonBody<{ path?: string; name?: string }>(req)
          if (!body.path) {
            jsonResponse(res, 400, { error: 'path is required' })
            return
          }
          const name = body.name || body.path.split('/').filter(Boolean).pop() || 'unnamed'
          const today = new Date().toISOString().slice(0, 10)
          await registry.add(name, {
            path: body.path,
            type: 'generic',
            tags: [],
            status: 'new',
            added: today,
            bundles: [],
          })
          jsonResponse(res, 201, { registered: name })
        } catch (err) {
          jsonResponse(res, 500, { error: (err as Error).message })
        }
      },
    })
  }, 'agenthub add endpoint')

  ctx.effect(function* () {
    yield ctx.webServer.register({
      kind: 'exact',
      path: '/agenthub-api/remove',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        try {
          const body = await readJsonBody<{ name?: string }>(req)
          if (!body.name) {
            jsonResponse(res, 400, { error: 'name is required' })
            return
          }
          await registry.remove(body.name)
          jsonResponse(res, 200, { removed: body.name })
        } catch (err) {
          jsonResponse(res, 500, { error: (err as Error).message })
        }
      },
    })
  }, 'agenthub remove endpoint')
}