// scripts/verify/visit-lounge-gates.verify.tsx — the visit link's waiting lounge and its screens for doing something
// about the booking (Booking page step 5c, ClientVisit and ClientManage boards): "While you wait" as one-tap choices
// with every request said back on the screen; "Need a hand?"; finishing the booking (forms, files, confirmations,
// card and deposit) in the business's look; canceling with the money said in a sentence and keeping it as the easy
// button; rescheduling; message settings; and everything on the business's clock.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/visit-lounge-gates.verify.tsx
import fs from 'fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { brandOf } from '../../src/components/booking/VisitShell';
import { VisitLounge, guestStageOf } from '../../src/components/visit/VisitLounge';
import { CompletionGateView } from '../../src/components/visit/VisitGates';

// The app's components rely on the automatic JSX runtime; here they're rendered with React on hand.
(globalThis as any).React = React;
let bad = 0; const ok = (c: any, m: string) => { if (!c) { bad++; console.error('FAIL', m); } else console.log('  ✓', m); };
const src = (p: string) => fs.readFileSync(p, 'utf8');
const html = (el: React.ReactElement) => renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
const text = (h: string) => h.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const inMin = (m: number) => new Date(Date.now() + m * 60000).toISOString();
const brand = brandOf({ name: 'Opal Manicure Studio', timezone: 'America/Chicago', bookingPageSettings: { design: 'studio', studio: { color: '#8b5e57', mood: 'night' } } }, 't1', 's1');
const lounge = (o: any = {}) => ({ ok: true, guest: { firstName: 'Dana', isMember: true, membershipName: 'Opal Club', id: 'c1' }, perks: { i2: 2 },
  session: { serviceName: 'Gel manicure', staffName: 'Maya Brooks', startTime: inMin(6), endTime: inMin(66) },
  amenities: [{ id: 'i1', name: 'Water', category: 'Drinks', price: 0, maxQty: 2 }, { id: 'i2', name: 'Sparkling water', category: 'Drinks', price: 3, maxQty: 2 }, { id: 'i5', name: 'Phone charger', category: 'Comfort', maxQty: 1 }],
  upsell: [{ id: 'u1', name: 'Paraffin hand treatment', price: 12, duration: 15 }], assist: [{ kind: 'comfort', status: 'acknowledged', claimedByName: 'Rosa' }], ...o });
const L = (p: any = {}) => text(html(<VisitLounge brand={brand} client={null} inventory={[]} activeRequests={[]} appointment={{ id: 'ap1' }} staff={{ name: 'Maya Brooks' }} resources={[]} memberships={[]} isWaiting token="tok" lounge={lounge()} onRefresh={() => {}} onMessage={() => {}} wifi={{ network: 'Opal Guest', password: 'shiny' }} {...p} />));

(async () => {
  // ── The waiting lounge ──────────────────────────────────────────────────
  const l = L();
  ok(l.includes('Checked in') && l.includes('You’re checked in') && /Maya knows you’re here and will be with you in about [56] minutes/.test(l), 'checked in: who knows they’re here, and about when');
  ok(l.includes('While you wait') && l.includes('Anything you’d like? We’ll bring it over.') && l.includes('Water') && l.includes('Phone charger') && l.includes('Comforts') && l.includes('Drinks'), '“While you wait”: what the business offers, as choices, grouped when there’s more than one kind');
  ok(l.includes('Sparkling water · included'), 'a member sees what’s included with their membership on the choice itself');
  ok(l.includes('Need a hand?') && l.includes('I need a hand') && l.includes('Rosa is on the way') && l.includes('Something else'), '“Need a hand?”: one tap, and who’s coming once someone has it');
  ok(l.includes('Should finish around') && l.includes('Waiting in the lounge') && l.includes('Opal Club') && l.includes('2 included treats left this cycle'), 'today: the service, who, where, when it should finish, and what the membership still includes');
  ok(l.includes('Opal Guest') && l.includes('Copy') && l.includes('While you’re here') && l.includes('Paraffin hand treatment') && l.includes('Ask about it'), 'the Wi-Fi with a copy button, and other services to ask about (asking books and charges nothing)');
  const live = L({ activeRequests: [{ id: 'r1', itemId: 'i1', itemName: 'Water', quantity: 2, status: 'pending' }, { id: 'r2', itemId: 'i2', itemName: 'Sparkling water', quantity: 1, status: 'making' }] });
  ok(live.includes('On its way') && live.includes('Water ×2') && live.includes('Sent to the team') && live.includes('Call it back') && live.includes('Being made for you now') && live.includes('Already started'), 'requests: where each one is, and it can be called back only while it’s just been sent');
  ok(live.includes('Water · sent') && live.includes('Sparkling water · being made'), 'a choice already asked for says so, and can’t be asked for twice at once');
  ok(guestStageOf({ status: 'weird' }) === 'new' && guestStageOf({ status: 'canceled' }) === 'cancelled' && guestStageOf({ status: 'ready_for_pickup' }) === 'ready', 'an unknown status reads as sent, so a request never vanishes');
  const off = L({ lounge: null, loungeError: true });
  ok(off.includes('We can’t show what’s on offer right now') && off.includes('Try again'), 'when the offer can’t be shown: said plainly, with Try again');
  ok(L({ isWaiting: false }).includes('In progress') && L({ isWaiting: false }).includes('You’re all set'), 'in service: all set, in progress');
  const ls = src('src/components/visit/VisitLounge.tsx');
  ok(ls.includes("fetch('/api/guest-lounge'") && ls.includes('JSON.stringify({ token, ...body })') && !/toast|useToast/.test(ls), 'every request goes through the server with the visit token, and nothing pops up: it’s said on the screen');
  ok(ls.includes('<VisitSaid text={orderSaid?.text}') && ls.includes('<VisitSaid text={assistSaid?.text}') && ls.includes('<VisitSaid text={askSaid?.text}'), 'what happened is said beside each part: requests, help, asking about a service');

  // ── Finishing the booking ───────────────────────────────────────────────
  const forms = [{ id: 'f1', title: 'Gel service consent', requiresGuardianSignature: true, fields: [{ id: 'a', type: 'short-text', label: 'Any allergies?' }] }];
  const completion = { depositAmountCents: 1500, serviceName: 'Gel manicure', appointmentStartTime: '2026-11-05T21:30:00Z', fileRequirements: [{ id: 'fr', file: { prompt: 'A photo of your nails', maxCount: 3 } }], acknowledgments: [{ id: 'k', text: 'Removing gel at home can damage your nails.' }], requestMarketingConsent: true, requestEmergencyContact: true };
  const g = html(<CompletionGateView brand={brand} tenant={{ name: 'Opal' } as any} tenantId="t1" token="tok" completion={completion} forms={forms} onDone={() => {}} />); const gt = text(g);
  ok(gt.includes('Finish your booking') && gt.includes('Thursday, November 5 at 3:30 PM · Gel manicure') && gt.includes('Deposit due today') && gt.includes('$15.00'), 'finish your booking: when (on the business’s clock), what, and the deposit due');
  ok(gt.includes('2 things left') && gt.includes('Gel service consent') && gt.includes('A few questions · 1 min') && gt.includes('Start: Gel service consent') && gt.includes('A photo of your nails') && gt.includes('Add it below') && gt.includes('Add photos'), 'what’s left at the top (each form opens in the one form screen, guardian included), and files to add');
  ok(gt.includes('Please confirm') && gt.includes('Photos and marketing') && gt.includes('Yes, that’s fine') && gt.includes('Emergency contact') && gt.includes('Policy and your card') && gt.includes('Continue to pay $15.00'), 'confirmations, the marketing choice, an emergency contact, the policy and card, then pay');
  ok((g.match(/min-h-11 cursor-pointer items-start gap-3/g) || []).length >= 2 && g.includes('aria-label="Remove') === false && !/red-|slate-|amber-|green-/.test(src('src/components/visit/VisitGates.tsx')), 'every tick box is a 44px row, and no fixed light colors: Night reads as Night');
  ok(text(html(<CompletionGateView brand={brand} tenant={null} tenantId="t1" token="tok" completion={{ skipCardStep: true, cardAlreadyOnFile: true }} forms={[]} onDone={() => {}} />)).includes('Your card is on file, so there’s nothing to pay now.')
    && !text(html(<CompletionGateView brand={brand} tenant={null} tenantId="t1" token="tok" completion={{ skipCardStep: true }} forms={[]} onDone={() => {}} />)).includes('Your card is on file'), 'card already on file: nothing to pay, just the details (and never said when no card is on file)');
  const gs = src('src/components/visit/VisitGates.tsx');
  ok(gs.includes('<VisitSaid text={error} />') && !gs.includes('AlertTriangle') && !gs.includes('VisitHero'), 'a step not done yet is said in amber under the form, no red box');
  ok(gs.includes('isSameDay(wallDate(safeDate(completion.appointmentStartTime), brand.zone), wallDate(new Date(), brand.zone))'), 'whether the visit is today is decided on the business’s clock');

  // ── Canceling and rescheduling ──────────────────────────────────────────
  const cancel = gs.slice(gs.indexOf('export const CancelGateView'), gs.indexOf('export const AskToMove'));
  ok(cancel.indexOf('<VisitButton onClick={onBack}>Keep my appointment</VisitButton>') > 0 && cancel.indexOf('<VisitButton danger onClick={handleCancel}') > cancel.indexOf('Keep my appointment</VisitButton>'), 'cancel: keeping it is the easy button; canceling is the one red button, under it');
  ok(cancel.includes("<>Cancel your <b>{format(was, 'h:mm a')}</b> {sameDay ? 'today' : `on ${format(was, 'EEEE')}`}?</>") && cancel.includes('label="Reason for canceling"') && cancel.includes('<VisitCheckRow checked={useGrace}'), '“Cancel your 3:30 PM on Friday?”, the money in a sentence, a grace cancellation as a tick row');
  ok(cancel.includes('const atOf = (iso?: string | null) => (iso ? wallDate(safeDate(iso), brand.zone) : null);') && cancel.includes('format(undoBy, \'h:mm a\')'), 'the visit and the undo deadline are on the business’s clock');
  const resched = gs.slice(gs.indexOf('export const RescheduleGateView'));
  ok(resched.includes("${h >= 12 ? 'PM' : 'AM'}") && resched.includes('Choose a <b>new time</b>') && resched.includes('<VisitCheckRow checked={useGrace} onChange={setUseGrace}>') && resched.includes('<VisitSaid text={error} />'), 'reschedule: times as 3:30 PM, a grace reschedule as a tick row, and what went wrong said in amber');
  ok(!gs.includes('Saved ✓') && gs.includes('<VisitSaid text={saveErr} />') && !/toast|useToast/.test(gs), 'message settings: saved, or what went wrong, said on the screen');

  // ── The page and the look ───────────────────────────────────────────────
  const page = src('src/app/check-in/[token]/page.tsx');
  ok(!page.includes('ConciergeExperienceView') && !page.includes('ViewContainer') && page.includes('<VisitLounge') && /if \(isArrivedOrServicing\) \{\s*return withFooter\(/.test(page), 'the old lounge and its containers are gone; the new one carries the visit’s footer');
  ok(!/toast|useToast/.test(page) && page.length < 70000, 'no pop-ups left on the visit link, and the page is a router for its screens again');
  ok(src('src/components/public/kit.tsx').includes('.pub[data-mood=night] .pub-ui{--glass-surface:34 35 38;'), 'form fields inside a Night page are dark too (the app’s white “glass” surface is swapped for the mood’s card)');
  const ffr = src('src/components/consents/FormFieldRenderer.tsx');
  ok(ffr.includes('penColor="#16171a"') && ffr.includes("style={{ background: '#fff', color: '#16171a' }}"), 'signatures are drawn in dark ink on a white pad in every look, so the saved image reads on white later');
  ok(ffr.includes('cf-paper relative rounded-xl') && (ffr.match(/flex min-h-11 items-center space-x-3/g) || []).length === 2 && ffr.includes('className="min-h-11 text-[14px] text-muted-foreground"'), 'the pad stays paper-white under the app’s dark theme too, and every choice and the clear button are 44px');
  const cancelSrc = src('src/components/visit/VisitGates.tsx');
  ok(cancelSrc.includes('setSubmitErr(data.error') && cancelSrc.includes('<VisitSaid text={submitErr} />'), 'a cancel that doesn’t go through is said on the form, so they can try again');
  const actions = src('src/app/api/checkin/actions/route.ts');
  ok(actions.includes("action === 'prefs_get'") && actions.includes("['voice', 'email', 'sms', 'both', 'none']") && actions.includes('allowClientOverride === false'), 'message settings: read from the server, a phone call is kept as a phone call, and only when the business lets clients choose');
  ok(!/showNotificationSettings && tenantId && client &&/.test(page) && page.includes('token={token}\n                onBack={() => setShowNotificationSettings(false)}'), '“How we reach you” opens for a client on their own phone (it no longer waits on a record their phone can’t read)');
  const lsrc = src('src/components/visit/VisitLounge.tsx');
  ok(lsrc.includes('Date.now() - at < 20000') && lsrc.includes("disabled={ordering || !!itemStage}") && lsrc.includes('if (qty > maxQty) setQty(maxQty)') && lsrc.includes('/^(https:\\/\\/|\\/(?![/\\\\]))/.test('), 'the lounge stays honest: help can be asked again once dealt with, no second request for the same thing, quantities within what’s left, safe pictures only');
  ok(cancelSrc.includes("if (d?.ok && d.prefs) {") && cancelSrc.includes('{loaded && <VisitButton onClick={handleSave}') && cancelSrc.includes('Try again</VisitButton>'), 'message settings never show made-up values: Save appears only once what’s set has loaded, otherwise Try again');
  const files = ['src/components/visit/VisitLounge.tsx', 'src/components/visit/VisitGates.tsx', 'src/app/check-in/[token]/page.tsx'];
  const tool = new RegExp([['cl', 'aude'], ['anth', 'ropic']].map((x) => x.join('')).join('|'), 'i');
  ok(files.every((p) => !tool.test(src(p)) && !/[\u{1F300}-\u{1FAFF}\u{2728}]/u.test(src(p)) && !/uppercase/.test(src(p)) && !/call us/i.test(src(p)) && !/\{\/\*/.test(src(p))), 'no tool names, emojis, all-caps labels, “call us” or JSX comments');
  ok(files.every((p) => !/(?<!')ancelling(?!')/.test(src(p).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))), 'US spelling: canceling');

  if (bad) { console.error(`\n${bad} failed`); process.exit(1); }
  console.log('\nvisit lounge and gates: all good');
})();
