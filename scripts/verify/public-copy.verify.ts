// scripts/verify/public-copy.verify.ts — checks the visit-link copy gate (lib/public-visit-copy): what an appointment
// turns into when copied to appointmentCheckIns/{token}, and how an old full copy is cleaned.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/public-copy.verify.ts
import { makeDb, check, failures, FV } from './fake-db';

(async () => {
  const P = await import('../../src/lib/public-visit-copy');

  const full: any = {
    id: 'apt1', tenantId: 't1', clientId: 'c1', clientName: 'Maya Lopez', clientPhone: '+15551234567', clientEmail: 'maya@example.com',
    serviceId: 'svc1', serviceName: 'Gel manicure', staffId: 's1', staffName: 'Ana', startTime: '2026-10-14T16:00:00Z', endTime: '2026-10-14T17:00:00Z',
    status: 'confirmed', checkInStatus: 'pending', stage: 'booked', checkInToken: 'tok_abcdef123456', shortCode: 'K7Q2',
    depositStatus: 'paid', depositAmountCents: 2500, timelinePublic: [{ at: 'x', text: 'Booked' }], timelineShowTimes: true,
    disruption: { kind: 'callout', status: 'pending' }, providerDelay: null, lateReply: null, lateChoices: { options: ['wait'] }, etaAt: null,
    place: 'online', meetingLink: 'https://meet.example.com/x', requiredResourceIds: ['chair1'], soonerOn: true,
    signedForms: [{ formId: 'f1', formTitle: 'Health questions', formData: { allergies: 'latex', pregnant: 'yes' }, signedAt: '2026-10-01T10:00:00Z' }],
    internalNotes: 'difficult client', notes: 'please call my cell', inspirationPhotos: [{ url: 'https://x/p.jpg' }], inspirationPhotoUrl: 'https://x/p.jpg',
    conflictOverride: { reason: 'squeeze in', by: 'Owner' }, cardOnFile: { customerId: 'cus_1' }, stripePaymentIntentId: 'pi_1', checkoutSessionId: 'cs_1',
    address: '1 Main St', clientAddress: '1 Main St', renterServicePrice: 80, price: 60, totalPrice: 60, hasCardOnFile: true, padBefore: 5,
  };

  console.log('publicVisitCopy — a whole appointment');
  const c = P.publicVisitCopy(full);
  for (const k of ['internalNotes', 'notes', 'inspirationPhotos', 'inspirationPhotoUrl', 'clientPhone', 'clientEmail', 'conflictOverride', 'cardOnFile',
    'stripePaymentIntentId', 'checkoutSessionId', 'address', 'clientAddress', 'renterServicePrice', 'price', 'totalPrice', 'hasCardOnFile', 'padBefore'])
    check(`drops ${k}`, !(k in c), c[k]);
  check('no form answers anywhere in the copy', !JSON.stringify(c).includes('latex') && !JSON.stringify(c).includes('formData'));
  check('signedForms keeps formId + signedAt only', JSON.stringify(c.signedForms) === JSON.stringify([{ formId: 'f1', signedAt: '2026-10-01T10:00:00Z' }]), c.signedForms);
  check('client name cut to the first name', c.clientName === 'Maya' && c.clientFirst === 'Maya', [c.clientName, c.clientFirst]);
  for (const k of ['id', 'tenantId', 'clientId', 'serviceId', 'serviceName', 'staffId', 'startTime', 'endTime', 'status', 'checkInStatus', 'stage', 'checkInToken',
    'depositStatus', 'depositAmountCents', 'timelinePublic', 'timelineShowTimes', 'disruption', 'lateChoices', 'place', 'meetingLink', 'requiredResourceIds', 'soonerOn'])
    check(`keeps ${k}`, JSON.stringify(c[k]) === JSON.stringify(full[k]), c[k]);
  check('null values pass through (clears still clear)', 'providerDelay' in c && c.providerDelay === null && 'lateReply' in c && c.lateReply === null);

  console.log('publicVisitCopy — a merge patch');
  const patch = P.publicVisitCopy({ checkInStatus: 'arrived', notes: 'by the window', sensoryNeeds: 'quiet', visitContact: { phone: '+1555' }, tenantId: 't1', lateTimeMinutes: undefined });
  check('only the safe keys that were sent', JSON.stringify(Object.keys(patch).sort()) === JSON.stringify(['checkInStatus', 'tenantId']), patch);
  check('nothing invented for keys that were not sent', !('signedForms' in patch) && !('clientName' in patch) && !('id' in patch));
  const sentinel = FV.delete();
  check('sentinel values on safe keys are left alone', P.publicVisitCopy({ lateReply: sentinel }).lateReply === sentinel);

  console.log('scrub — an old full copy in the database');
  const db = makeDb();
  await db.doc('appointmentCheckIns/tok_abcdef123456').set(full);
  const stored = (await db.doc('appointmentCheckIns/tok_abcdef123456').get()).data();
  const sp = P.scrubVisitPatch(stored, FV.delete)!;
  check('a patch is produced for a dirty copy', !!sp);
  await db.doc('appointmentCheckIns/tok_abcdef123456').update(sp);
  const after = (await db.doc('appointmentCheckIns/tok_abcdef123456').get()).data();
  check('after the scrub: no forbidden key is left', P.strayVisitKeys(after).length === 0, P.strayVisitKeys(after));
  check('after the scrub: form answers are gone, formId/signedAt stay', JSON.stringify(after.signedForms) === JSON.stringify([{ formId: 'f1', signedAt: '2026-10-01T10:00:00Z' }]), after.signedForms);
  check('after the scrub: the page’s fields are untouched', after.tenantId === 't1' && after.id === 'apt1' && after.startTime === full.startTime && after.checkInToken === full.checkInToken && after.status === 'confirmed');
  check('after the scrub: first name only', after.clientName === 'Maya');
  check('a clean copy needs no patch', P.scrubVisitPatch(after, FV.delete) === null);
  check('a copy written through publicVisitCopy needs no patch', P.scrubVisitPatch(P.publicVisitCopy(full), FV.delete) === null);

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed'); process.exit(failures ? 1 : 0);
})();
