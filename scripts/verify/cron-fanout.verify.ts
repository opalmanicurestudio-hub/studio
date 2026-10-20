// Checks background jobs share their time fairly across businesses and resume where they stopped.
// Run: npx tsx scripts/verify/cron-fanout.verify.ts
import { forEachTenant } from '../../src/lib/cron-fanout';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };
function db(n: number) {
  const store: any = {};
  return { store, collection: () => ({ get: async () => ({ docs: Array.from({ length: n }, (_, i) => ({ id: `t${i}`, data: () => ({}) })) }) }), doc: () => ({ get: async () => ({ data: () => store.c }), set: async (v: any) => { store.c = { ...(store.c || {}), ...v }; } }) };
}
async function main() {
  const d = db(10); const seen: string[] = [];
  const r1 = await forEachTenant(d as any, 'job', async (t) => { seen.push(t.id); await new Promise((x) => setTimeout(x, 30)); }, { concurrency: 2, budgetMs: 70 });
  ok(r1.ranOut && r1.done < 10 && r1.nextStart === r1.done, 'stops starting new businesses at the time limit and remembers where');
  const first = r1.done; const seen2: string[] = [];
  const r2 = await forEachTenant(d as any, 'job', async (t) => { seen2.push(t.id); }, { concurrency: 3, budgetMs: 5000 });
  ok(seen2[0] === `t${first}` && r2.done === 10 && !r2.ranOut && r2.nextStart === 0, 'next run starts where the last stopped, and a full run resets');
  let failed = 0; const r3 = await forEachTenant(db(4) as any, 'j2', async (t) => { if (t.id === 't1') { failed++; throw new Error('x'); } }, {});
  ok(r3.done === 4 && failed === 1, 'one business failing never stops the others');
  if (bad) { console.log(`\n${bad} failed`); process.exit(1); } else console.log('\nall good');
}
void main();
