/**
 * AgentHub session log — append-only JSONL records every /agenthub slash
 * command invocation.
 *
 * Lives in `~/AgentHub/sessions/<YYYY-MM-DD>.jsonl` so multiple sessions
 * in a day share a file. Each record carries:
 *   - ts        Unix epoch milliseconds
 *   - iso       ISO-8601 timestamp
 *   - subcmd     first token of the slash-command input (e.g. 'list')
 *   - args      rest of the input
 *   - result    'success' | 'error'
 *   - text      short summary of the response (truncated)
 *   - agentId   identifier of the caller (free text; 'unknown' until
 *               we integrate with dsh session headers in v0.7.0)
 *
 * @module @sxzl798/agenthub/sessions
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'

export interface SessionRecord {
  /** Unix epoch milliseconds. */
  ts: number
  /** ISO-8601 timestamp. */
  iso: string
  /** Slash-command subcommand (e.g. 'list', 'show', 'doctor'). */
  subcmd: string
  /** Remaining args. */
  args: string
  /** Result kind. */
  result: 'success' | 'error'
  /** Short summary of the response, truncated to MAX_PREVIEW_CHARS. */
  text: string
  /** Identifier of the agent / process that issued the command. */
  agentId: string
}

const MAX_PREVIEW_CHARS = 200

/** Strip control chars and collapse whitespace so log lines stay one line. */
function sanitize(s: string): string {
  return s.replace(/[\r\n\t]+/g, ' ').slice(0, MAX_PREVIEW_CHARS)
}

/** Append-only recorder. Single instance per plugin lifetime is fine. */
export class SessionRecorder {
  private hubDir: string

  constructor(hubDir: string) {
    this.hubDir = hubDir
  }

  /** Resolve the day's JSONL file path. */
  private filePath(iso: string): string {
    const day = iso.slice(0, 10) // YYYY-MM-DD
    return join(this.hubDir, 'sessions', `${day}.jsonl`)
  }

  /** Append one record. Returns the file path written to. */
  async append(rec: SessionRecord): Promise<string> {
    const path = this.filePath(rec.iso)
    await fs.mkdir(join(this.hubDir, 'sessions'), { recursive: true })
    await fs.appendFile(path, JSON.stringify(rec) + '\n', 'utf8')
    return path
  }

  /** Build a record from raw slash-command inputs. */
  static makeRecord(
    rawInput: string,
    result: 'success' | 'error',
    text: string,
    agentId = 'unknown',
  ): SessionRecord {
    const tokens = rawInput.trim().split(/\s+/).filter(Boolean)
    const subcmd = tokens[0] || ''
    const args = tokens.slice(1).join(' ')
    const ts = Date.now()
    const iso = new Date(ts).toISOString()
    return {
      ts,
      iso,
      subcmd,
      args,
      result,
      text: sanitize(text),
      agentId,
    }
  }

  /** Read the most recent N records across all session files. */
  async tail(n: number): Promise<SessionRecord[]> {
    const dir = join(this.hubDir, 'sessions')
    let entries: string[]
    try {
      entries = await fs.readdir(dir)
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') return []
      throw err
    }
    entries = entries.filter((e) => e.endsWith('.jsonl')).sort().reverse()
    const records: SessionRecord[] = []
    for (const file of entries) {
      if (records.length >= n) break
      const path = join(dir, file)
      const lines = (await fs.readFile(path, 'utf8')).trim().split('\n').reverse()
      for (const line of lines) {
        if (records.length >= n) break
        try {
          records.push(JSON.parse(line) as SessionRecord)
        } catch {
          /* skip malformed line */
        }
      }
    }
    return records
  }

  /** Format the last N records as a human-readable table. */
  static formatRecords(records: SessionRecord[]): string {
    if (records.length === 0) return 'No session records yet.'
    const lines: string[] = [`${records.length} record(s), newest first`]
    lines.push('TIME'.padEnd(21) + 'SUBCMD'.padEnd(12) + 'RESULT'.padEnd(9) + 'ARGS / TEXT')
    lines.push('-'.repeat(80))
    for (const r of records) {
      const time = r.iso.replace('T', ' ').slice(0, 19)
      const subcmd = r.subcmd.padEnd(12)
      const result = r.result.padEnd(9)
      const text = `${r.args} → ${r.text}`.trim()
      lines.push(`${time.padEnd(21)} ${subcmd} ${result} ${text.slice(0, 80)}`)
    }
    return lines.join('\n')
  }
}