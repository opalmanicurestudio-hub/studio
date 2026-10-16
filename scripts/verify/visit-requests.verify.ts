// scripts/verify/visit-requests.verify.ts — one readiness answer for every screen, and the request message.
import { pendingFormIds, startBlocker, intakeComplete, requestMessage } from '../../src/lib/visit-requests';
let bad = 0; const ok = (c: any, m: string, d?: any) => { if (!c) { bad++; console.error('FAIL', m, d === undefined ? '' : JSON.stringify(d)); } else console.log('  ✓', m); };
const svc = { id: 's', requiredFormIds: ['f1', 'f2'] };
const apt = { status: 'confirmed', requiredFormIds: ['f3'], signedForms: [{ formId: 'f1' }] };
ok(JSON.stringify(pendingFormIds(apt, svc, {})) === '["f2","f3"]', 'service forms plus the visit’s own, less those signed on this visit', pendingFormIds(apt, svc, {}));
ok(JSON.stringify(pendingFormIds(apt, svc, { signedForms: { f2: { signedAt: 'x' } } })) === '["f3"]', 'a form signed on an earlier visit counts');
ok(JSON.stringify(pendingFormIds(apt, svc, { signedForms: { f2: { signedAt: 'x', everyVisit: true } } })) === '["f2","f3"]', 'unless it must be signed every visit');
ok(JSON.stringify(pendingFormIds(apt, svc, { signedForms: { f2: {} } }, [{ id: 'f2', requiresEveryAppointment: true }])) === '["f2","f3"]', 'the form list can say every visit too');
ok(startBlocker(apt, svc, {}) === 'Form not signed', 'forms block starting');
ok(startBlocker({ status: 'confirmed', readinessFlags: { depositRequired: true }, depositAmountCents: 2500 }, { id: 's' }) === 'Deposit not paid', 'a required deposit blocks');
ok(startBlocker({ status: 'confirmed', depositAmountCents: 2500 }, { id: 's' }) === null, 'a deposit that isn’t required doesn’t');
ok(startBlocker({ status: 'completed' }, svc) !== null && startBlocker({ status: 'requested' }, svc) === 'Accept the booking first', 'finished and requested visits can’t start');
ok(startBlocker({ status: 'confirmed', signedForms: [{ formId: 'f1' }, { formId: 'f2' }] }, svc) === null, 'ready');
ok(intakeComplete({ completionStatus: 'completed' }) && intakeComplete({ completionStatus: 'complete' }) && !intakeComplete({ completionStatus: 'pending' }), 'complete or completed');
const m = requestMessage({ firstName: 'Sam', studioName: 'Opal', startTime: '2026-10-16T19:00:00.000Z', tzOffsetMinutes: -240, items: ['forms', 'photo_current', 'card'], reason: 'requirements', link: 'https://x/check-in/abc' });
ok(m.text.includes('sign your form, add a photo of how things look now and save a card') && m.text.includes('3:00 PM') && m.text.endsWith('https://x/check-in/abc'), 'one message, one link, plain words', m.text);
ok(!/call us/i.test(m.text + m.lines.join(' ')), 'never “call us”');
console.log(bad ? `${bad} failed` : 'all good'); if (bad) process.exit(1);
