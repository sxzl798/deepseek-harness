// Quick smoke test for RegistryService + SkillsService.
// Run from repo root: pnpm tsx scripts/smoke-agenthub.mts

import { SkillsService } from '../packages/agenthub/agenthub/src/skills.ts'
import { RegistryService } from '../packages/agenthub/agenthub/src/registry.ts'

// Minimal Cordis-compatible ctx: Service constructor only needs reflect.provide.
class MockCtx {
  reflect = { provide: () => undefined }
}

const hubDir = RegistryService.defaultHubDir()
const ctx = new MockCtx() as never

const reg = new RegistryService(ctx, { hubDir })
const skills = new SkillsService(ctx, { hubDir })

console.log(`hub:       ${hubDir}`)
console.log(`skills:    ${skills.skillsDir}`)

const projects = await reg.list()
const names = Object.keys(projects).sort()
console.log(`projects:  ${names.length}`)
for (const n of names) {
  const p = projects[n]
  console.log(`  - ${n.padEnd(20)} [${p.status}] ${p.type}`)
}

const list = await skills.list()
console.log(`\nskills:    ${list.length}`)
for (const s of list) {
  console.log(`  - ${s.name.padEnd(20)} ${s.description.slice(0, 70)}`)
}

const mcpSetup = await skills.show('mcp-setup')
if (mcpSetup) {
  console.log(`\n=== mcp-setup body (first 200 chars) ===`)
  console.log(mcpSetup.body.slice(0, 200))
}

console.log('\n✓ smoke test passed')