// scripts/verify/digital-notices.verify.ts — a download's later messages (lib/digital-notices): access ending soon, a
// new version of a file, and the team's alert for a file a buyer couldn't open.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/digital-notices.verify.ts
import fs from 'fs';
import { endingDue, endingLeadMs, endingMessage, changedFiles, updateDue, updateMessage, missingAlert, missingKey } from '../../src/lib/digital-notices';
import { buildEntitlement } from '../../src/lib/entitlements';
import { applyAction } from '../../src/lib/entitlement-actions';

let bad = 0; const ok = (c: any, m: string, d?: any) => { if (!c) { bad++; console.error('FAIL', m, d === undefined ? '' : JSON.stringify(d).slice(0, 300)); } else console.log('  ✓', m); };
const read = (p: string) => fs.readFileSync(p, 'utf8');
const DAY = 86400e3;
const now = Date.parse('2026-10-29T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

// ── when "ending soon" goes
ok(endingLeadMs(iso(now - 365 * DAY), iso(now + 3 * DAY)) === 7 * DAY, 'a long window: a week before');
ok(endingLeadMs(iso(now), iso(now + 8 * DAY)) === 2 * DAY, 'an eight-day window: two days before');
ok(endingLeadMs(iso(now), iso(now + 2 * DAY)) === DAY, 'never under a day');
const ent: any = { status: 'active', access: { startsAt: iso(now - 30 * DAY) }, notices: {} };
const end = iso(now + 5 * DAY);
ok(endingDue(ent, { open: true, endsAt: end }, now), 'five days left on a month: due');
ok(!endingDue(ent, { open: true, endsAt: iso(now + 10 * DAY) }, now), 'ten days left: not yet');
ok(!endingDue({ ...ent, notices: { endingFor: end } }, { open: true, endsAt: end }, now), 'once per end date');
ok(endingDue({ ...ent, notices: { endingFor: iso(now + 1 * DAY) } }, { open: true, endsAt: end }, now), 'an extension moves the date: warned again before the new end');
ok(!endingDue(ent, { open: false, endsAt: end }, now), 'not for access already closed (refunded, chargeback)');
ok(!endingDue({ ...ent, status: 'revoked' }, { open: true, endsAt: end }, now), 'not for access the shop closed');
ok(!endingDue(ent, { open: true, endsAt: null }, now), 'never for access that’s yours to keep');
ok(!endingDue(ent, { open: true, endsAt: iso(now - DAY) }, now), 'not after it ended');
const em = endingMessage('Gel guide', 'Opal', end, 2);
ok(/ends Nov 3, 2026/.test(em.subject) && /2 downloads left/.test(em.line) && /order page/.test(em.ask), 'the email says when, and downloads left');
ok(/Reply to this email/.test(endingMessage('Gel guide', 'Opal', end, null, true).ask), 'a gift’s recipient is told to reply, not to use an order page');
ok(/no downloads left, but you can still read it online/.test(endingMessage('G', 'O', end, 0).line), 'no downloads left is said kindly');
ok(/Nov 2, 2026/.test(endingMessage('G', 'O', '2026-11-03T03:00:00.000Z', null, false, 'America/New_York').subject), 'the day is the shop’s day, not the server’s');

// ── the record keeps the end the reminder looks for
const e2: any = buildEntitlement('t1', { id: 'o1', paidAt: iso(now), customerEmail: 'a@b.co', lines: [] }, { lineId: 'l1', productId: 'p1', digitalAccessDays: 30 }, {});
ok(e2.accessEnd === e2.access.endsAt && !!e2.accessEnd, 'a new record carries its end');
ok(buildEntitlement('t1', { id: 'o2', paidAt: iso(now) }, { lineId: 'l1', productId: 'p1' }, {}).accessEnd === null, 'and none when it’s for good');
const ext: any = applyAction({ ...e2, history: [] }, { kind: 'extend', until: iso(now + 90 * DAY) }, 'J', iso(now));
ok(ext.ok && ext.patch.accessEnd === iso(now + 90 * DAY), 'an extension moves it');
const fv: any = applyAction({ ...e2, history: [] }, { kind: 'extend', until: 'forever' }, 'J', iso(now));
ok(fv.ok && fv.patch.accessEnd === null, 'extended for good: no reminder ever');

// ── a new version
const ch = changedFiles([{ id: 'a', version: 1 }, { id: 'b', version: 2 }], [{ id: 'a', version: 2, name: 'Guide.pdf' }, { id: 'b', version: 2, name: 'Cards.zip' }, { id: 'c', version: 1, name: 'New.pdf' }]);
ok(ch.length === 1 && ch[0].id === 'a', 'only a file whose version went up counts (an added file isn’t an update)');
ok(changedFiles([{ id: 'main', version: 1 }], [{ id: 'fnew', version: 2, name: 'Guide.pdf' }]).length === 1, 'replacing a product’s single older file counts too');
ok(changedFiles([{ id: 'main', version: 1 }], [{ id: 'fnew', version: 1, name: 'Other.pdf' }]).length === 0, 'but swapping it for a first version doesn’t');
ok(changedFiles([{ id: 'main', version: 1 }], [{ id: 'fnew', version: 2, name: 'Guide.pdf' }, { id: 'fadd', version: 1, name: 'Extra.pdf' }]).map((f) => f.id).join() === 'fnew', 'even when another file is added in the same save');
const e3: any = buildEntitlement('t1', { id: 'o3', paidAt: iso(now) }, { lineId: 'l1', productId: 'p1' }, { digitalFiles: [{ id: 'a', name: 'G.pdf', path: 'x', version: 3 }] });
ok(e3.notices.updated.a === 3 && !updateDue(e3, [{ id: 'a', version: 3 }]) && updateDue(e3, [{ id: 'a', version: 4 }]), 'a record knows the versions bought, so nobody hears about a version they already have');
ok(updateDue({ notices: {} }, [{ id: 'a', version: 2 }]) && !updateDue({ notices: { updated: { a: 2 } } }, [{ id: 'a', version: 2 }]) && updateDue({ notices: { updated: { a: 2 } } }, [{ id: 'a', version: 3 }]), 'each version once per buyer');
const um = updateMessage('Gel guide', 'Opal', [{ name: 'Guide.pdf' }]);
ok(/new version of Guide\.pdf/.test(um.line) && /no extra cost/.test(um.line) && um.cta === 'Open my library', 'the email names the file and costs nothing');
ok(updateMessage('G', 'O', [{ name: 'a' }], true).cta === 'Open my gift', 'a gift’s recipient opens their gift');

// ── the team's alert
ok(/no file or link yet/.test(missingAlert('Gel guide', 'unattached')) && /couldn't be fetched from storage/.test(missingAlert('Gel guide', 'missing')), 'the team is told what to do');
ok(missingKey('p/1', '2026-10-29') === 'digital_missing_p1_2026-10-29', 'once per item a day');

// ── wired in
const srv = read('src/lib/digital-notices-server.ts');
ok(/runTransaction/.test(srv) && /'notices\.endingFor': st\.endsAt/.test(srv) && /'notices\.endingFor': null/.test(srv), 'ending: claimed first, and given back when the email didn’t go');
ok(/`notices\.updated\.\$\{f\.id\}`/.test(srv) && !/notices: \{ \.\.\.\(ent\.notices/.test(srv), 'marks written by their own path, so two messages at once never undo each other');
ok(/budgetMs/.test(srv) && /startAfter\(last\)/.test(srv) && /more: true/.test(srv), 'both senders page through everyone and stop at a time budget, carrying on next time');
ok(/f\.version >= 2/.test(srv) && /ent\.createdAt/.test(srv), 'only real new versions, never to someone who bought after it');
ok(/\['accessEnd', 'access\.endsAt', 'access\.extendedUntil'\]/.test(srv), 'finds records by their end, older records and older extensions too');
ok(/variantIdsOf\(item\)/.test(srv) && /!st\?\.open \|\| ent\.status === 'revoked'/.test(srv), 'updates reach buyers of its variants too, never closed access');
ok(/\.create\(/.test(srv) && /item\?\.parentId/.test(srv) && /inventory\/\$\{where\}/.test(srv) && /\/inventory\/product\//.test(srv), 'the alert is written once a day, and points at the product holding the files');
ok(/sweepEndingNotices/.test(read('src/lib/retail-nightly.ts')), 'the nightly shop checks send the reminders');
const da = read('src/app/api/retail/digital-access/route.ts');
ok((da.match(/alertMissingFile\(/g) || []).length === 2 && /The shop has been told/.test(da), 'a missing or unattached file tells the team, and the buyer knows it did');
const rt = read('src/app/api/retail/digital/notify-update/route.ts');
ok(/isManager/.test(rt) && /slice\(0, 10\)/.test(rt), 'only managers email buyers');
const ds = read('src/components/inventory/DigitalSection.tsx');
ok(/changedFiles\(start\.files, files\)/.test(ds) && /Email buyers/.test(ds) && /Not now/.test(ds), 'after saving a new version the shop is asked, never sent without asking');

console.log(bad ? `\n${bad} failed` : '\nall passed'); process.exit(bad ? 1 : 0);
