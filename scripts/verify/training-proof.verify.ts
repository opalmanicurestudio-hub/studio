// Checks lib/training-proof links: proof links expire and can't be moved to another document; inspector keys are per link.
// Run: npx tsx scripts/verify/training-proof.verify.ts
import { proofPath, proofOk, inspectorPath, inspectorKeyOk } from '../../src/lib/training-proof';
let bad = 0; const ok = (c: boolean, m: string) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };
const u = new URL(`https://x${proofPath('t1', 'doc1')}`); const e = u.searchParams.get('e')!, k = u.searchParams.get('k')!;
ok(u.pathname === '/print/training/t1/doc1', 'proof path');
ok(proofOk('t1', 'doc1', e, k), 'valid proof link');
ok(!proofOk('t1', 'doc2', e, k), 'key doesn’t work for another document');
ok(!proofOk('t2', 'doc1', e, k), 'or another business');
ok(!proofOk('t1', 'doc1', String(Number(e) + 1000), k), 'a changed expiry is refused');
const old = new URL(`https://x${proofPath('t1', 'doc1', -1)}`); ok(!proofOk('t1', 'doc1', old.searchParams.get('e')!, old.searchParams.get('k')!), 'expired link refused');
const ip = new URL(`https://x${inspectorPath('t1', 'L1')}`); const ik = ip.searchParams.get('k')!;
ok(inspectorKeyOk('t1', 'L1', ik) && !inspectorKeyOk('t1', 'L2', ik) && !inspectorKeyOk('t1', 'L1', 'nope'), 'inspector key per link');
console.log(bad ? `${bad} failed` : 'All checks passed'); process.exit(bad ? 1 : 0);
