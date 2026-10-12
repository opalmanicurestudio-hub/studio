// Checks lib/client-verify (codes, trusted phones, "Not you?") and lib/health-privacy (discreet messages, health mode).
// Run: npx tsx --tsconfig tsconfig.json scripts/verify/client-verify.verify.ts
import { makeDb, check, failures } from './fake-db';
import { startVerify, checkVerify, deviceTrusted, notMe, maskPhone, maskEmail } from '../../src/lib/client-verify';
import { privacyOf, discreetVersion, isHealthBusiness } from '../../src/lib/health-privacy';
import { textAssist } from '../../src/lib/text-assist';

(async () => {
  const now = Date.parse('2026-10-12T15:00:00Z');
  const fresh = async () => { const db = makeDb();
    await db.doc('tenants/t1').set({ name: 'Opal' });
    await db.doc('tenants/t1/staff/own').set({ id: 'own', name: 'Jess', role: 'owner' });
    await db.doc('tenants/t1/staff/tech').set({ id: 'tech', name: 'Ana', role: 'stylist' });
    await db.doc('tenants/t1/clients/c1').set({ id: 'c1', name: 'Rosa Diaz', phone: '(555) 123-4567', email: 'rosa@example.com' });
    await db.doc('tenants/t1/appointments/a1').set({ id: 'a1', clientId: 'c1', status: 'confirmed', startTime: '2026-10-14T15:00:00Z', checkInToken: 'tok1' });
    await db.doc('tenants/t1/appointments/a0').set({ id: 'a0', clientId: 'c1', status: 'completed', startTime: '2026-08-01T15:00:00Z', checkInToken: 'tok0' });
    return db; };

  console.log('Codes');
  { const db = makeDb(); const sent: any[] = []; const send = async (m: any) => { sent.push(m.msg); };
    await db.doc('tenants/t1').set({ name: 'Opal' }); await db.doc('tenants/t1/clients/c1').set({ id: 'c1', name: 'Rosa', phone: '5551234567', email: 'rosa@example.com' });
    const r: any = await startVerify(db, 't1', 'c1', { now, send });
    check('a code goes to the phone on record', r.ok && sent[0]?.to === '5551234567' && sent[0]?.channel === 'sms', r);
    check('where it went is masked', r.sentTo === 'the number ending in 4567', r.sentTo);
    const code = String(sent[0].text.match(/\d{6}/)?.[0]);
    check('the text has a 6-digit code and says when it expires', /^\d{6}$/.test(code) && /expires in 10 minutes/.test(sent[0].text));
    const v: any = (await db.doc(`tenants/t1/clientVerifications/${r.verificationId}`).get()).data();
    check('only a hash of the code is stored', v && !JSON.stringify(v).includes(code) && v.codeHash?.length === 64);
    const wrong: any = await checkVerify(db, 't1', { verificationId: r.verificationId, code: code === '000000' ? '111111' : '000000', device: '', now });
    check('a wrong code is refused', !wrong.ok);
    const okr: any = await checkVerify(db, 't1', { verificationId: r.verificationId, code, device: 'dev_1', now: now + 60000 });
    check('the right code confirms', okr.ok && okr.clientId === 'c1' && okr.device === 'dev_1', okr);
    check('the phone is marked confirmed', !!((await db.doc('tenants/t1/clients/c1').get()).data() as any).phoneVerifiedAt);
    check('the device is trusted', await deviceTrusted(db, 't1', 'c1', 'dev_1', now + 120000));
    check('…for another client, no', !(await deviceTrusted(db, 't1', 'c2', 'dev_1', now)));
    check('…after 90 days, no', !(await deviceTrusted(db, 't1', 'c1', 'dev_1', now + 91 * 864e5)));
    const again: any = await checkVerify(db, 't1', { verificationId: r.verificationId, code, device: 'dev_2', now: now + 120000 });
    check('a code works once', !again.ok);
    const r2: any = await startVerify(db, 't1', 'c1', { now, send }); const c2 = String(sent[1].text.match(/\d{6}/)?.[0]);
    const late: any = await checkVerify(db, 't1', { verificationId: r2.verificationId, code: c2, now: now + 11 * 60000 });
    check('an expired code is refused', !late.ok && /expired/.test(late.error));
    const r3: any = await startVerify(db, 't1', 'c1', { now, send }); const c3 = String(sent[2].text.match(/\d{6}/)?.[0]);
    for (let i = 0; i < 5; i++) await checkVerify(db, 't1', { verificationId: r3.verificationId, code: c3 === '999999' ? '999998' : '999999', now });
    const after: any = await checkVerify(db, 't1', { verificationId: r3.verificationId, code: c3, now });
    check('five wrong tries locks the code', !after.ok && /Too many/.test(after.error));
    await startVerify(db, 't1', 'c1', { now, send }); await startVerify(db, 't1', 'c1', { now, send });
    const sixth: any = await startVerify(db, 't1', 'c1', { now, send });
    check('at most 5 codes an hour', !sixth.ok && sent.length === 5);
    const em: any = await startVerify(db, 't1', 'c1', { now: now + 2 * 3600e3, send, channel: 'email' });
    check('email option masked', em.ok && em.sentTo === 'the email r•••@example.com' && sent[5].channel === 'email');
    const noDev: any = await checkVerify(db, 't1', { verificationId: em.verificationId, code: String(sent[5].text.match(/\d{6}/)?.[0]), now: now + 2 * 3600e3 });
    check('desk check (no device) confirms without trusting a device', noDev.ok && noDev.device === null && !!((await db.doc('tenants/t1/clients/c1').get()).data() as any).emailVerifiedAt);
  }
  check('maskPhone / maskEmail', maskPhone('+1 (555) 123-4567') === 'ending in 4567' && maskEmail('jo@x.com') === 'j•••@x.com');

  console.log('Not you?');
  { const db = await fresh();
    const r: any = await notMe(db, 't1', { clientId: 'c1', via: 'link', now });
    const c: any = (await db.doc('tenants/t1/clients/c1').get()).data();
    check('the number is flagged', !!c.phoneReportedWrongAt && c.phoneReportedWrongVia === 'link');
    check('upcoming links are turned off', !!((await db.doc('tenants/t1/appointments/a1').get()).data() as any).linkRevokedAt && r.linksOff === 1);
    check('old visits are left alone', !((await db.doc('tenants/t1/appointments/a0').get()).data() as any).linkRevokedAt);
    const notes = (await db.collection('tenants/t1/notifications').get()).docs.map((d: any) => d.data());
    check('the desk is told (managers only)', notes.length === 1 && notes[0].userId === 'own' && /ending in 4567/.test(notes[0].message), notes);
    const sent: any[] = []; const send = async (m: any) => { sent.push(m.msg); };
    const s: any = await startVerify(db, 't1', 'c1', { now, send });
    check('no codes to a reported number', !s.ok && sent.length === 0);
  }
  { const db = await fresh(); const sent: any[] = [];
    const r: any = await textAssist(db, 't1', { clientId: 'c1', from: '+15551234567', body: 'Wrong number', inboxId: 'i1' }, now, { send: async (m: any) => { sent.push(m); } });
    check('texting WRONG reports it', r.replied && !!((await db.doc('tenants/t1/clients/c1').get()).data() as any).phoneReportedWrongAt);
    check('…and gets one polite reply', sent.length === 1 && sent[0].kind === 'wrong_number_ack' && /stopped messages/.test(sent[0].text));
    const r2: any = await textAssist(db, 't1', { clientId: 'c1', from: '+15551234567', body: 'cancel', inboxId: 'i2' }, now + 3600e3, { send: async (m: any) => { sent.push(m); } });
    check('later texts from that number wait for a person', !r2.replied && sent.length === 1);
  }

  console.log('Health privacy');
  check('a med spa is a health business', isHealthBusiness({ businessType: 'medspa' }) && !isHealthBusiness({ businessType: 'nails' }));
  const p = privacyOf({ businessType: 'Aesthetic clinic' });
  check('health mode on by default for one', p.healthMode && p.discreet && p.autoSignOutMin === 15 && !p.modelAllowed && p.retentionYears === 7);
  check('the model returns once the agreement is signed', privacyOf({ businessType: 'medspa', privacy: { modelAgreementSigned: true } }).modelAllowed);
  check('a salon can turn discreet on alone', (() => { const q = privacyOf({ businessType: 'nails', privacy: { discreet: true } }); return q.discreet && !q.healthMode && q.modelAllowed; })());
  check('the owner can turn health mode off', !privacyOf({ businessType: 'medspa', privacy: { healthMode: false } }).healthMode);
  const dv = discreetVersion({ kind: 'appointment_reminder', channel: 'sms', text: 'Hi Rosa, your Botox with Dr. Lee is tomorrow at 2 PM. Details: https://x.co/check-in/tok1' }, 'Opal');
  check('discreet text keeps only the link', !!dv && !/Botox|Lee|2 PM/.test(dv.text) && dv.text.includes('https://x.co/check-in/tok1'), dv);
  const de = discreetVersion({ kind: 'appointment_reminder', channel: 'email', text: 'Your filler visit', subject: 'Filler tomorrow' }, 'Opal');
  check('discreet email subject is neutral', de?.subject === 'An update from Opal' && !/filler/i.test(de?.text || ''));
  check('codes are never rewritten', discreetVersion({ kind: 'verify_code', channel: 'sms', text: 'code 123456' }, 'Opal') === null);

  console.log(failures ? `\n${failures} FAILED` : '\nAll passed'); process.exit(failures ? 1 : 0);
})();
