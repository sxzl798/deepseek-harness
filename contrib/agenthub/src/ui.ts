/**
 * AgentHub web UI — serves the dashboard HTML on the dsh webServer.
 *
 * The HTML lives at `contrib/agenthub/ui/index.html` and is loaded from
 * disk on every plugin apply (not bundled) so iterating on the
 * dashboard is a one-step edit-reload cycle. The page fetches the
 * JSON API at `/agenthub-api/*` to render its table.
 *
 * Two routes are registered:
 *   /agenthub-ui        prefix — serves index.html for any subpath
 *
 * @module @sxzl798/agenthub/web-ui
 */

import { type Context } from '@deepseek-ai/cordis'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** Inject webServer so we can register routes. */
export const inject = ['webServer'] as const

function sendHtml(res: ServerResponse, body: string, status = 200): void {
  res.statusCode = status
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-length', String(Buffer.byteLength(body)))
  res.end(body)
}

/** Mount the UI on the dsh webServer under `/agenthub-ui`. */
export async function registerWebUi(
  ctx: Context,
  uiDir: string,
): Promise<void> {
  const indexPath = join(uiDir, 'index.html')
  // Re-read the file on every request when its mtime changes. Cheap
  // stat; useful while iterating on the dashboard during dev.
  let cachedHtml = await fs.readFile(indexPath, 'utf8')
  let lastMtimeMs = (await fs.stat(indexPath)).mtimeMs

  ctx.effect(function* () {
    yield ctx.webServer.register({
      kind: 'prefix',
      path: '/agenthub-ui',
      handler: async (_req: IncomingMessage, res: ServerResponse) => {
        try {
          const stat = await fs.stat(indexPath)
          if (stat.mtimeMs !== lastMtimeMs) {
            cachedHtml = await fs.readFile(indexPath, 'utf8')
            lastMtimeMs = stat.mtimeMs
          }
          sendHtml(res, cachedHtml)
        } catch (err) {
          sendHtml(
            res,
            `<h1>agenthub UI load error</h1><pre>${(err as Error).message}</pre>`,
            500,
          )
        }
      },
    })

    // Convenience redirect: /agenthub → /agenthub-ui/ so users who
    // discover only the namespace name land on the dashboard without
    // typing the full path. Avoids conflict with dsh's own / route.
    yield ctx.webServer.register({
      kind: 'exact',
      path: '/agenthub',
      handler: (_req: IncomingMessage, res: ServerResponse) => {
        res.statusCode = 302
        res.setHeader('location', '/agenthub-ui/')
        res.end()
      },
    })
  }, 'agenthub web UI')
}