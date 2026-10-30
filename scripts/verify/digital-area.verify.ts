// scripts/verify/digital-area.verify.ts — the Digital products area: what the shop can change for one buyer
// (lib/entitlement-actions), that the change reaches the one access rule, and that only managers make it, on the server.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/digital-area.verify.ts
import fs from 'fs';
import { applyAction, cleanAction, buyerMessage, FOREVER } from '../../src/lib/entitlement-actions';
import { digitalLineAccess } from '../../src/lib/digital-access';
import { downloadsLeft, accessEndsAt, publicEntitlement } from '../../src/lib/entitlements';

let bad = 0; const ok = (c: any, m: string, d?: any) => { if (!c) { bad++; console.error('FAIL', m, d === undefined ? '' : JSON.stringify(d).slice(0, 300)); } else console.log('  ✓', m); };
const now = '2026-10-29T12:00:00.000Z';
const ent: any = { id: 'o1_l1', status: 'active', downloads: { allowed: 5, used: 5, extra: 0 }, access: { days: 30, startsAt: '2026-10-01T12:00:00Z', endsAt: '2026-10-31T12:00:00.000Z', extendedUntil: null }, history: [{ at: '2026-10-01', what: 'Bought' }] };

// ── what can be asked
ok(cleanAction({ kind: 'add_downloads', count: 5 })?.kind === 'add_downloads' && !cleanAction({ kind: 'add_downloads', count: 0 }) && !cleanAction({ kind: 'add_downloads', count: 500 }), 'more downloads: 1 to 100');
ok(cleanAction({ kind: 'extend', until: 'forever' }) && cleanAction({ kind: 'extend', until: '2026-12-31T23:59:59' }) && !cleanAction({ kind: 'extend', until: 'soon' }), 'extend to a date, or for good');
ok(!cleanAction({ kind: 'revoke', reason: '  ' }) && cleanAction({ kind: 'revoke', reason: 'Shared online' }), 'closing needs a reason');
ok(!cleanAction({ kind: 'delete' }), 'nothing else');

// ── what each does
const more = applyAction(ent, { kind: 'add_downloads', count: 3 }, 'Jess', now) as any;
ok(more.ok && more.patch.downloads.extra === 3 && downloadsLeft({ downloads: more.patch.downloads }) === 3 && more.patch.history.at(-1).by === 'Jess', 'three more downloads, kept on the history with who');
ok(!(applyAction({ ...ent, downloads: { allowed: null, used: 2, extra: 0 } }, { kind: 'add_downloads', count: 1 }, 'J', now) as any).ok, 'no extra downloads on a record with no limit');
const ext = applyAction(ent, { kind: 'extend', until: '2026-12-31T23:59:59.000Z' }, 'J', now) as any;
const line = { lineId: 'l1', productId: 'p1', digital: true, qtyOrdered: 1, digitalAccessDays: 30 };
const order = { stage: 'completed', paidAt: '2026-10-01T12:00:00Z', totalCents: 1800, lines: [line] };
ok(ext.ok && digitalLineAccess(order, line, Date.parse('2026-11-15T00:00:00Z'), { ...ent, ...ext.patch }).open && !digitalLineAccess(order, line, Date.parse('2026-11-15T00:00:00Z'), ent).open, 'an extension opens it past its window, through the one rule');
const fv = applyAction(ent, { kind: 'extend', until: 'forever' }, 'J', now) as any;
ok(fv.ok && fv.patch.access.extendedUntil === FOREVER && digitalLineAccess(order, line, Date.parse('2030-01-01T00:00:00Z'), { ...ent, ...fv.patch }).open, 'for good is for good');
ok(digitalLineAccess(order, line, Date.parse(now), { ...ent, ...fv.patch }).endsAt === null && accessEndsAt({ ...ent, ...fv.patch }) === null && publicEntitlement({ ...ent, ...fv.patch })!.endsAt === null, 'and the buyer is never shown a far-off date: no end date at all');
ok(!(applyAction(ent, { kind: 'extend', until: '2026-10-30T00:00:00.000Z' }, 'J', now, { endsAt: '2026-10-31T12:00:00.000Z' }) as any).ok, 'an extension must end later than access already does');
ok(/no end date/.test((applyAction(ent, { kind: 'extend', until: 'forever' }, 'J', now, { endsAt: null }) as any).error), 'nothing to extend when there is no end');
ok(['add_downloads', 'extend', 'reopen'].every((k) => !(applyAction({ ...ent, status: k === 'reopen' ? 'revoked' : 'active' }, k === 'add_downloads' ? { kind: 'add_downloads', count: 1 } : k === 'extend' ? { kind: 'extend', until: 'forever' } : { kind: 'reopen' }, 'J', now, { endsAt: ent.access.endsAt, closedFor: 'refunded' }) as any).ok) && (applyAction(ent, { kind: 'revoke', reason: 'x' }, 'J', now, { closedFor: 'refunded' }) as any).ok, 'a refund can’t be undone here, but closing still can');
ok(!(applyAction(ent, { kind: 'extend', until: '2026-10-01T00:00:00.000Z' }, 'J', now) as any).ok, 'an end date in the past is refused');
const rv = applyAction(ent, { kind: 'revoke', reason: 'Shared online' }, 'J', now) as any;
ok(rv.ok && rv.patch.status === 'revoked' && rv.patch.revoked.reason === 'Shared online' && digitalLineAccess(order, line, Date.parse(now), { ...ent, ...rv.patch }).reason === 'revoked', 'closing closes it everywhere');
ok(!(applyAction({ ...ent, status: 'revoked' }, { kind: 'revoke', reason: 'x' }, 'J', now) as any).ok && (applyAction({ ...ent, status: 'revoked' }, { kind: 'reopen' }, 'J', now) as any).patch.status === 'active', 'closed once; opened again');
ok(!(applyAction(ent, { kind: 'reopen' }, 'J', now) as any).ok, 'nothing to open when it isn’t closed');
ok(digitalLineAccess({ ...order, refundedCents: 1800 }, line, Date.parse(now), { ...ent, ...fv.patch }).reason === 'refunded', 'an extension never reopens a refund');
const long = applyAction({ ...ent, history: Array.from({ length: 60 }, (_, i) => ({ at: '', what: String(i) })) }, { kind: 'add_downloads', count: 1 }, 'J', now) as any;
ok(long.patch.history.length === 50 && long.patch.history[0].what === '0', 'the history keeps when it was bought and the last 49 changes');
ok(/gave you 3 more downloads of Guide/.test(buyerMessage({ kind: 'add_downloads', count: 3 }, 'Guide', 'Opal').line) && /Their reason: Shared online\. If you think/.test(buyerMessage({ kind: 'revoke', reason: 'Shared online.' }, 'Guide', 'Opal').line), 'the buyer is told plainly');

// ── wiring
const route = fs.readFileSync('src/app/api/retail/digital/access/route.ts', 'utf8');
ok(route.includes('verifyStaffActor(req, tenantId)') && route.includes("if (!auth.actor?.isManager) return bad('Only managers can change a buyer’s access.', 403);"), 'only managers, checked on the server');
ok(route.includes("closedFor: acc.open ? null : acc.reason") && route.includes('db.runTransaction(') && route.includes('tx.set(ref, r.patch, { merge: true })'), 'one transaction on the buyer’s record');
const page = fs.readFileSync('src/app/(app)/inventory/digital/page.tsx', 'utf8');
ok(page.includes("fetch('/api/retail/digital/access'") && page.includes('staffAuthHeader()') && !/setDoc|updateDoc|addDoc/.test(page), 'the page changes access only through the server');
ok(page.includes('digitalLineAccess(order, line, now, ent)') && page.includes("from '@/lib/digital-access-rule'") && !fs.readFileSync('src/lib/digital-access-rule.ts', 'utf8').includes("from 'crypto'"), 'each buyer’s status comes from the one access rule, without server code in the browser');
ok(fs.readFileSync('src/app/(app)/inventory/page.tsx', 'utf8').includes('href="/inventory/digital"'), 'Products links to it when there’s anything digital');

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
