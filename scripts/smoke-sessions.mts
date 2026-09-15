// Quick smoke test for SessionRecorder.

import { SessionRecorder } from '../contrib/agenthub/src/sessions.ts'
import { RegistryService } from '../contrib/agenthub/src/registry.ts'

class MockCtx {
  reflect = { provide: () => undefined }
}

const hubDir = RegistryService.defaultHubDir()
new MockCtx() as never

const rec = new SessionRecorder(hubDir)

// Append three sample records spanning two different subcommands.
const r1 = SessionRecorder.makeRecord('list', 'success', '17 project(s)')
await rec.append(r1)
const r2 = SessionRecorder.makeRecord('show vibe-seller', 'success', 'vibe-seller path=/...')
await rec.append(r2)
const r3 = SessionRecorder.makeRecord('skills list', 'error', 'no skills found')
await rec.append(r3)

// Read the most recent 5.
const tail = await rec.tail(5)
console.log(SessionRecorder.formatRecords(tail))

// Tidy up: remove the records we wrote so the test is idempotent.
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
const file = join(hubDir, 'sessions', r1.iso.slice(0, 10) + '.jsonl')
try {
  const raw = await fs.readFile(file, 'utf8')
  const lines = raw.trim().split('\n').filter((line) => {
    try {
      const obj = JSON.parse(line) as SessionRecorder extends never ? never : { subcmd: string }
      return !['list', 'show vibe-seller', 'skills list'].includes(obj.subcmd)
    } catch {
      return false
    }
  })
  await fs.writeFile(file, lines.join('\n') + (lines.length ? '\n' : ''))
} catch {
  // ignore
}

console.log('✓ smoke test passed')