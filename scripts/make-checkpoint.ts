// Generate a QA checkpoint world headlessly: an ordinary simulation run (no
// manipulation) from a seed to a day, checked for resource conservation every
// tick, written through the real SaveStore as a browser save slot.
//   node --experimental-strip-types scripts/make-checkpoint.ts <seed> <day> <out.json> [slot]
// The output is { key, value } — a localStorage entry the game's Load dialog reads.
import { writeFileSync } from 'node:fs'
import { conservationTotals } from '../src/sim/__tests__/invariants.ts'
import { SaveStore } from '../src/persistence/storage.ts'
import { deserialize, serialize } from '../src/sim/serialize.ts'
import { createWorld, step } from '../src/sim/world.ts'

const [seed, dayArg, out, slot = 'slot1'] = process.argv.slice(2)
if (!seed || !dayArg || !out) throw new Error('usage: make-checkpoint.ts <seed> <day> <out.json> [slot]')
const s = createWorld({ seed })
const start = conservationTotals(s)
const ticks = (Number(dayArg) - 1) * 240
for (let t = 0; t < ticks; t++) {
  step(s)
  const now = conservationTotals(s)
  if (now.food !== start.food || now.wood !== start.wood) throw new Error(`conservation broke at tick ${s.tick}`)
}
const json = serialize(s)
if (serialize(deserialize(json)) !== json) throw new Error('save does not round-trip')
const mem = new Map<string, string>()
const storage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size
  },
}
const result = new SaveStore(storage).save(slot as 'slot1', s)
if (!result.ok) throw new Error(`save failed: ${JSON.stringify(result)}`)
const [key, value] = [...mem.entries()][0]!
writeFileSync(out, JSON.stringify({ key, value }))
const living = s.citizens.filter((c) => c.alive)
const age = (c: (typeof living)[number]) => Math.floor((s.tick - c.bornTick) / (48 * 240))
console.log(
  JSON.stringify({
    seed, day: Number(dayArg), tick: s.tick, living: living.length,
    children: living.filter((c) => age(c) < 14).length, elders: living.filter((c) => age(c) >= 50).length,
    couples: living.filter((c) => c.partnerId !== null && c.partnerId > c.id).length,
    founders: living.filter((c) => c.parentIds === null).length,
    dead: s.citizens.filter((c) => !c.alive).length, archived: s.archive.length,
    counters: s.population.counters, shelters: s.structures.filter((x) => x.kind === 'shelter' && x.stage === 'complete').length,
    homeless: living.filter((c) => c.homeId === null).length, saveKB: +(value.length / 1024).toFixed(1),
  }),
)
