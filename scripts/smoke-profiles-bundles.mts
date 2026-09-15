// Quick smoke test for ProfilesService + BundlesService.

import { ProfilesService } from '../packages/agenthub/agenthub/src/profiles.ts'
import { BundlesService } from '../packages/agenthub/agenthub/src/bundles.ts'
import { RegistryService } from '../packages/agenthub/agenthub/src/registry.ts'

class MockCtx {
  reflect = { provide: () => undefined }
}

const hubDir = RegistryService.defaultHubDir()
const ctx = new MockCtx() as never

const profiles = new ProfilesService(ctx, { hubDir })
const bundles = new BundlesService(ctx, { hubDir })

// profiles
console.log('=== ProfilesService ===')
const list = await profiles.list()
console.log('list:', list.map((p) => p.name))
console.log('active:', await profiles.active())
const focusPrefix = await profiles.getPromptPrefix('focus')
console.log('focus prefix (first 80 chars):', focusPrefix.slice(0, 80))
const focusBody = await profiles.get('focus')
console.log('focus body length:', focusBody?.length ?? 0)

// bundles
console.log('\n=== BundlesService ===')
const bList = await bundles.list()
console.log('list:', bList.map((b) => b.name))
const dshWeb = await bundles.get('dsh-web')
if (dshWeb) {
  console.log('dsh-web description:', dshWeb.description.slice(0, 60))
  console.log('dsh-web skills:', dshWeb.skills)
  console.log('dsh-web prompt_prefix (first 80 chars):', dshWeb.prompt_prefix.slice(0, 80))
}

console.log('\n=== Profiles summary ===')
console.log(await profiles.summary())
console.log('\n=== Bundles summary ===')
console.log(await bundles.summary())

console.log('\n✓ smoke test passed')