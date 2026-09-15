// Quick smoke test for RegistryService + SkillsService + DoctorService.
// Run from repo root: pnpm tsx scripts/smoke-agenthub.mts

import { SkillsService } from '../contrib/agenthub/src/skills.ts'
import { RegistryService } from '../contrib/agenthub/src/registry.ts'
import { DoctorService } from '../contrib/agenthub/src/doctor.ts'

// Minimal Cordis-compatible ctx: Service constructor only needs reflect.provide.
class MockCtx {
  reflect = { provide: () => undefined }
}

const hubDir = RegistryService.defaultHubDir()
const ctx = new MockCtx() as never

const reg = new RegistryService(ctx, { hubDir })
const skills = new SkillsService(ctx, { hubDir })
const doctor = new DoctorService(ctx)

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

console.log('\n--- doctor on loopagent ---')
const loopagentReport = await doctor.check('/Users/hzj/Developer/cc26/loopagent')
console.log(DoctorService.formatReport(loopagentReport))

console.log('\n--- doctor on ppt-master (known 4/9 pass) ---')
const pptMasterReport = await doctor.check('/Users/hzj/Developer/cc26/ppt-master')
console.log(DoctorService.formatReport(pptMasterReport))

console.log('\n--- doctor all (batch) ---')
let totalPassed = 0
let totalWarned = 0
let totalFailed = 0
for (const n of names) {
  const r = await doctor.check(projects[n].path)
  const s = `${r.passed}p ${r.warned}w ${r.failed}f`
  console.log(`  ${n.padEnd(20)} ${s}`)
  totalPassed += r.passed
  totalWarned += r.warned
  totalFailed += r.failed
}
console.log(`Totals: ${totalPassed} passed, ${totalWarned} warnings, ${totalFailed} failures`)

console.log('\n✓ smoke test passed')