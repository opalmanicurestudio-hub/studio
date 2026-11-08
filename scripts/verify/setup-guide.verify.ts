// scripts/verify/setup-guide.verify.ts — Set up your business: the steps come from the tools the business uses, each
// opens the real page with a Skip / Next bar, progress is kept on the business, and Getting started lands here.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/setup-guide.verify.ts
import fs from 'fs';
import { GUIDE_STEPS, guideSteps, guideProgress, stepHref, stepAfter, othersLeft, guideOnShow } from '../../src/lib/setup-guide';
import { SETTINGS_GROUPS } from '../../src/lib/settings-registry';

let bad = 0; const ok = (c: any, m: string) => { if (!c) { bad++; console.error('FAIL', m); } else console.log('  ✓', m); };
const src = (p: string) => fs.readFileSync(p, 'utf8');
const ids = (s: { id: string }[]) => s.map((x) => x.id).join(',');
const none = { livePriced: 0, teamCount: 1 };

// Which steps a business sees
const solo = { modules: { retail: false, team: false } };
const shop = { modules: { retail: true, team: true } };
ok(ids(guideSteps(solo, none)) === 'details,hours,services,payments,booking,changes,messages', 'a business without a shop or a team sees only the steps it needs');
ok(ids(guideSteps(shop, none)) === 'details,hours,services,payments,booking,changes,messages,shop,team', 'the shop and team steps join when those tools are on');
ok(GUIDE_STEPS.every((s) => fs.existsSync(`src/app/(app)${s.href.split(/[?#]/)[0] === '/' ? '' : s.href.split(/[?#]/)[0]}/page.tsx`)), 'every step opens a page that exists');

// When a step is done
const t0 = { name: 'Opal', modules: solo.modules };
const s0 = guideSteps(t0, none);
ok(s0.every((s) => !s.done), 'a brand-new business has nothing done, even with the opening hours every new business starts with');
ok(s0.find((s) => s.id === 'details')?.note === 'Add your phone and address', 'the details step says exactly what’s missing');
ok(guideSteps({ ...t0, phone: '5', address: '1 Elm' }, none).find((s) => s.id === 'details')?.done === true && guideSteps({ ...t0, phone: '5', address: '1 Elm' }, none).find((s) => s.id === 'details')?.note === 'Add a logo if you have one', 'a logo is welcome but not required, so the step can be finished without one');
// The team step follows the "just me / a team" answer, not which tools are on
ok(ids(guideSteps({ teamSize: 'team', modules: { team: false } }, none)).endsWith(',team'), 'a business that said it’s a team gets the team step even without the Team tool');
ok(!ids(guideSteps({ teamSize: 'solo', modules: { team: true } }, none)).includes('team'), 'a business that said “just me” isn’t asked to build a team, even with the Team tool on');
ok(ids(guideSteps({ teamSize: 'solo', shape: { solo: false }, modules: {} }, none)).endsWith(',team'), 'a business that later says it’s a team (How your business works) gets the step');
const t1 = { ...t0, logoUrl: 'x', phone: '5', address: '1 Elm', stripeAccountId: 'acct', setupGuide: { done: { booking: '2026-01-01' }, skipped: { changes: '2026-01-01' } } };
const f1 = { livePriced: 3, teamCount: 1, toPrice: 2 };
const s1 = guideSteps(t1, f1);
ok(ids(s1.filter((s) => s.done)) === 'details,services,payments,booking', 'steps that need something real are done when it’s there; hours and the others when the owner looked and pressed Next');
ok(s1.find((s) => s.id === 'services')?.note === '3 on your booking page · 2 still need a price' && guideSteps(t0, { ...none, toPrice: 14 }).find((s) => s.id === 'services')?.note === '14 ready for your prices', 'the services step counts what clients can book, and starter services still waiting for a price');
ok(s1.find((s) => s.id === 'changes')?.skipped === true, 'a skipped step is remembered');
ok(guideSteps({ ...t0, stripeAccountId: 'a', stripeChargesEnabled: false }, none).find((s) => s.id === 'payments')?.done === false, 'payments aren’t done until the bank account can take cards');
ok(guideSteps({ ...t0, setupGuide: { done: { details: 'x' } } }, none).find((s) => s.id === 'details')?.done === false, 'pressing Next can’t tick a step that needs something real (a logo, a price)');

// Where the owner is
const p1 = guideProgress(s1);
ok(p1.doneCount === 4 && p1.total === 7 && p1.next?.id === 'hours' && !p1.finished, 'the next step skips the ones put off for later');
const all = { booking: 'x', hours: 'x', messages: 'x' };
const p2 = guideProgress(guideSteps({ ...t1, setupGuide: { done: all, skipped: { changes: 'x', payments: 'x' } } }, f1));
ok(p2.finished && !p2.allDone && p2.next?.id === 'changes' && p2.doneCount === 6, 'every step done or put off is finished, and the put-off ones are still there to come back to');
const skippedAll = guideProgress(guideSteps(t0, none).map((x) => ({ ...x, skipped: !x.done })));
ok(skippedAll.finished && !skippedAll.allDone, 'skipping every step finishes the walk-through but not the setup, so the guide stays in Settings');
ok(guideProgress(guideSteps({ ...t1, stripeAccountId: '', setupGuide: { done: { ...all, changes: 'x' }, skipped: { payments: 'x' } } }, f1)).finished, 'a business that takes cash only skips payments and still finishes');
ok(!guideProgress(guideSteps({ ...t1, setupGuide: { done: all } }, f1)).finished, 'a step neither done nor put off keeps the guide open');
ok(guideOnShow({}) && !guideOnShow({ setupGuide: { finishedAt: 'x' } }) && !guideOnShow({ setupGuide: { hidden: 'x' } }), 'the guide leaves Settings once it’s finished or hidden');
ok(stepHref(GUIDE_STEPS[0]) === '/settings?tab=profile&setup=details' && stepHref(GUIDE_STEPS.find((s) => s.id === 'booking')!) === '/settings/booking?setup=booking#rules', 'a step’s address keeps its tab and #part');
ok(stepAfter(s1, 'details')?.id === 'hours' && stepAfter(s1, 'messages') === null && othersLeft(s1, 'messages') && !othersLeft(guideSteps({ ...t1, setupGuide: { done: all, skipped: { changes: 'x' } } }, f1), 'messages'), 'Next goes forward to the next step still to do and stops at the end of the list, knowing whether anything earlier is left');
ok(SETTINGS_GROUPS.find((g) => g.id === 'business')?.pages.some((p) => p.id === 'setup' && p.href === '/settings/setup'), 'Set up your business is always a page under Your business, so it can be found after it leaves the top of Settings');

// On screen
const bar = src('src/components/settings/SetupGuide.tsx');
ok(bar.includes("params?.get('setup')") && bar.includes('Skip for now') && bar.includes("'Looks good, next'") && bar.includes('All steps'), 'a page opened from the guide shows which step it is, with Skip, Next and All steps');
ok(bar.includes("go(review && !cur.done ? 'done' : null)") && bar.includes("go('skipped')"), 'Next ticks a looked-at step; Skip puts it off');
ok(bar.includes('if (busy || !mayLeave()) return;') && (bar.match(/onClick=\{leaving\}/g) || []).length === 2, 'Next, Skip and All steps ask about unsaved edits first, like every other way off a settings page');
ok(bar.includes('aria-disabled={busy}') && !bar.includes('disabled={busy}\n') && !/\sdisabled=\{busy\}/.test(bar), 'pressing Next keeps keyboard focus on the button while it saves');
ok(bar.includes('<style>{BAR_CSS}</style>') && bar.includes('className="cf-setup-bar mx-auto') && bar.includes('.dark .cf-setup-bar{') && !bar.includes('SettingsStyle'), 'the bar has its own light and dark colors on every page, without changing anything else on the page');
ok(bar.includes("{review && !cur.done ? (next ? 'Looks good, next' : more ? 'Looks good' : 'Looks good, finish') : next ? 'Next' : more ? 'All steps' : 'Finish'}"), 'Finish shows only when nothing else is left; otherwise the last step leads back to all steps');
ok(bar.includes('if (asked.get(tenantId) !== mine) return cache.get(tenantId)?.data || null;'), 'an older answer arriving late never replaces a newer one');
ok(bar.includes('notedFor.has(tenantId)') && bar.includes('allowed && allDone && !noted') && bar.includes('if (!ok) notedFor.delete(tenantId);'), 'finishing is written once, only when every step is really done, and tried again if it didn’t save');
ok(bar.includes('if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;'), 'opening All steps in a new tab never asks about unsaved edits');
ok(bar.includes('z-[35]') && src('src/components/services/ServiceMenuBoard.tsx').includes("bottom: 'calc(24px + var(--cf-bar, 0px))'") && src('src/components/klair/Klair.tsx').includes('var(--cf-bar, 0px)') && bar.includes("root.style.setProperty('--cf-bar'"), 'sheets open over the bar; the services toast and the assistant’s button sit above it');
ok(bar.includes("document.getElementById('settings-page') || document.getElementById('main')") && bar.includes('left: box.left, width: box.width'), 'the bar sits over the page’s own column, beside the app’s sidebar or the Settings list');
ok(bar.includes('setInterval(') && bar.includes("document.visibilityState === 'visible' && n++ < 20"), 'a step waiting for something real checks again now and then while it’s open');
ok(bar.includes('pb-[max(12px,env(safe-area-inset-bottom))]') && bar.includes('h-[176px] sm:h-[112px]'), 'the bar clears the phone’s home bar, sits beside the Settings list, and never covers the end of the page');
ok(bar.includes("if (as && !(await g.mark(step, as))) { setBusy(false); setErr('That didn’t save. Try again.'); return; }") && bar.includes('role="alert"'), 'if a step doesn’t save, the owner stays on it and is told');
ok(bar.includes('sm:hidden') && bar.includes('flex-1 rounded-full') && bar.includes('sm:flex-none'), 'on a phone the two buttons share a full-width row and All steps moves up beside the step count');
ok(bar.includes("['owner', 'admin', 'manager']"), 'only owners and managers see the guide');
const page = src('src/app/(app)/settings/setup/page.tsx');
ok(page.includes('const hidden = !!(selectedTenant?.setupGuide?.hidden || selectedTenant?.setupGuide?.finishedAt);') && page.includes('aria-disabled={hideBusy}'), 'the hide button says Show whenever the guide is off Settings, and keeps keyboard focus while it saves');
ok(page.includes('role="progressbar"') && page.includes('aria-valuenow={p.doneCount}'), 'progress is a real progress bar');
ok(page.includes('g.data.facts.livePriced === 0') && page.includes('Prices are left to you'), 'a starter menu is offered only while nothing is on the booking page, and never sets prices');
ok(page.includes('download="booking-qr.png"') && page.includes('Copy link'), 'the booking link can be copied or saved as a QR code');
ok(page.includes('Setting up the business is for owners and managers.') && page.includes("!g.ready ? <p className=\"text-[15px]\" style={{ color: C.muted }}>Loading…</p>"), 'anyone else is told who it’s for, but not while the business is still loading');
ok(page.includes('Your steps didn’t load.') && page.includes('Try again') && bar.includes('failed: !!failed && failed === tenantId && !data'), 'if the steps don’t load, the page says so and offers to try again');
ok(page.includes("setQr(null); setMenu(''); setMsg(''); setCopied(false); }, [tenantId]);"), 'switching business clears the other business’s QR code and messages');
ok(page.includes("'Hide this from Settings'") && page.includes("g.mark('', hidden ? 'show' : 'hide')"), 'the owner can hide the guide from Settings, and bring it back');
ok(page.includes("r.added === 0 ? 'These are all on your list already.'") && page.includes("service${r.added === 1 ? '' : 's'} added"), 'adding a starter menu says how many were added, in good English');
const layout = src('src/app/(app)/layout.tsx');
ok(layout.includes('<React.Suspense fallback={null}><SetupBar /></React.Suspense>'), 'the bar can show on any page, not just Settings');

// In Settings
const shell = src('src/components/settings/SettingsShell.tsx'); const home = src('src/components/settings/SettingsHome.tsx');
ok(shell.includes('const guide = useSetupGuide(guideOnShow(selectedTenant), false);') && shell.includes('<span className="sr-only">, {guide.progress.doneCount} of {guide.progress.total} steps done</span>') && shell.includes('topSetup && guide.progress && (') && shell.includes('const topSetup = !!guide.progress && !guide.progress.allDone;') && shell.includes('{guide.progress.doneCount} of {guide.progress.total}') && shell.includes("aria-current={setupOn ? 'page' : undefined}"), 'the Settings list starts with Set up your business and how far along it is, until every step is done');
ok(home.includes('const setup = guide.progress && !guide.progress.allDone ? guide.progress : null;') && home.includes("putOff ? ` · ${putOff} for later` : ''") && home.includes('<section aria-label="Set up your business"') && home.includes('stepHref(setup.next)') && home.includes('role="progressbar"'), 'Settings home leads with a Set up your business card that continues where the owner left off');
ok(home.includes("!guide.steps && tenant && !tenant.logoUrl") && home.includes('useSetupGuide(guideOnShow(tenant))') && home.includes('attentionItems(tenant)') && home.includes('automation'), 'the setup checks it covers leave Needs you; automations and things switched off stay');
ok(bar.includes('const FRESH_MS = 3_000;') && bar.includes('const going = flying.get(tenantId); if (going && !force) return going;') && bar.includes('listeners.forEach((f) => f(tenantId, data))') && bar.includes('useSetupGuide(on = true, follow = true)'), 'places that open together ask for the counts once, and a fresh count reaches all of them');
ok(bar.includes('got && got.id === tenantId ? got.data') && bar.includes("if (!r?.ok || !r.facts) { listeners.forEach((f) => f(tenantId, null)); return null; }") && bar.includes('if (going && !force) return going;'), 'switching business never shows the other business’s counts, a bad answer never breaks the guide, and asking again never waits on an older answer');
ok(!page.includes('void g.reload(); }, [g.reload]'), 'the setup page asks for its counts once, with everything else on screen');
ok(page.includes("if (!ok) setHideErr('That didn’t save. Try again.')") && page.includes('if (forTenant.current === was) setQr(url);'), 'hiding says when it didn’t save, and a QR code made for the last business never shows on this one');

// Kept on the business
const api = src('src/app/api/getting-started/route.ts');
ok(api.includes("requireRole(req, tenantId, 'manager')") && api.includes("GUIDE_STEPS.some((x) => x.id === step)") && api.includes("['done', 'skipped', 'undo'].includes(as)"), 'only managers can mark a step, and only a real step');
ok(api.includes('FieldValue.delete()') && api.includes('{ setupGuide: patch }, { merge: true }'), 'marking one step never touches the others');
ok(api.includes("['hide', 'show', 'finished'].includes(as)") && api.includes("{ finishedAt: now }") && api.includes("as === 'show' ? { hidden: FieldValue.delete(), finishedAt: FieldValue.delete() }"), 'hiding, showing and finishing are kept on the business, and Show brings back a finished guide too');
ok(api.includes("guide ? null : db.collection(`${T}/clients`)") && api.includes("guide ? null : db.collection(`${T}/scheduleProfiles`)"), 'the guide reads only what its counts need');
ok(api.includes("String(b.tenantId || '').trim().slice(0, 120)"), 'the business id is read the same way the sign-in check reads it');
ok(api.includes("x.isActive !== false && x.type !== 'addon'") && api.includes(".select('status', 'isPrivate', 'price', 'type', 'isActive', 'createdVia')"), 'services count only what the booking page shows, reading only the fields needed');
ok(api.includes("const guide = action === 'guide';") && api.includes('if (guide) return j({ ok: true, facts: { livePriced: live, teamCount: team, toPrice }'), 'the guide gets the counts it needs from the server');

// Old links
const moving = src('src/components/import/MovingInCard.tsx');
ok(src('src/app/(app)/getting-started/page.tsx').includes("redirect('/settings/setup')") && moving.includes('href="/settings/setup"') && moving.includes("window.location.href = '/settings/setup'") && !moving.includes("'/getting-started'"), 'Getting started and the moving-in card land on Set up your business');
ok(moving.includes("useSetupGuide(isManager && settled && guideOnShow(tenant))") && moving.includes('{fresh.done} of {fresh.total} done') && !moving.includes('of 6'), 'the dashboard’s finish-setting-up card counts the same steps as the guide');
ok(moving.includes('!guide.progress.finished') && !moving.includes('!guide.progress.allDone'), 'the card goes once every step is done or put off for later, not only when everything is really done');
ok(moving.includes("const settled = !!tenant?.movingIn?.fresh || !!tenant?.movingIn?.dismissed || imported;") && moving.includes('if (r.ok && r.imports) setImported(true);'), 'an owner who brought things over from another app gets the card too, not only one who started fresh');

// House rules
const files = ['src/lib/setup-guide.ts', 'src/components/settings/SetupGuide.tsx', 'src/app/(app)/settings/setup/page.tsx', 'src/app/api/getting-started/route.ts', 'src/app/(app)/getting-started/page.tsx', 'src/components/settings/SettingsShell.tsx', 'src/components/settings/SettingsHome.tsx', 'src/components/import/MovingInCard.tsx', 'src/app/(app)/layout.tsx', 'src/components/klair/Klair.tsx', 'src/components/services/ServiceMenuBoard.tsx'];
ok(files.every((f) => !/\{\/\*/.test(src(f))), 'no JSX comments');
ok(files.every((f) => !/cancelled|cancelling|colour|programme|\bcall us\b/i.test(src(f))), 'US spelling, and never “call us”');
const tool = new RegExp(['cl', 'aude'].join('') + '|' + ['anth', 'ropic'].join(''), 'i');
ok(files.every((f) => !tool.test(src(f))), 'no tool names in the code');

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
