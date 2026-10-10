// src/app/api/feedback/route.ts — the client's "How was your visit?" page (lib/visit-feedback). Public: the signed link
// (?k=) or the visit's own link token (?t=) is the proof. GET → what the page shows. POST actions:
//   rate     { rating: 'loved' | 'okay' }                → saved on the visit (loved → the review link)
//   upload   { dataUrl }                                  → one photo or voice note, stored for this visit's case
//   report   { reasonId, words, wants, photos, voice, lang } → opens a Making it right case (one per visit)
//   confirm  { good, words }                              → "Did we make it right?"
//   redo_times { others? } · book_redo { staffId, date, time } · redo_none { note }  → choosing or moving the free redo
import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { feedbackVisit, feedbackInfo, feedbackPath } from '@/lib/visit-feedback';
import { openCase, clientConfirm, bookRedo, redoNone } from '@/lib/cases';
import { uploadClaimPhotoFromDataUrl } from '@/lib/claim-photo-upload';
export const dynamic = 'force-dynamic';
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams; const tenantId = String(q.get('tenantId') || ''); const id = String(q.get('id') || '');
  const db = getAdminDb(); const v = await feedbackVisit(db, tenantId, id, q.get('k'), q.get('t'));
  if (!v) return bad('This link isn’t valid any more.', 404);
  return NextResponse.json(await feedbackInfo(db, tenantId, v), { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  const b: any = await req.json().catch(() => ({})); const tenantId = String(b.tenantId || ''); const id = String(b.id || '');
  const db = getAdminDb(); const v = await feedbackVisit(db, tenantId, id, b.k, b.t);
  if (!v) return bad('This link isn’t valid any more.', 404);
  const info: any = await feedbackInfo(db, tenantId, v);
  const now = new Date().toISOString();

  if (b.action === 'rate') {
    const rating = b.rating === 'loved' ? 'loved' : 'okay';
    await v.ref.set({ feedback: { rating, at: now } }, { merge: true });
    return NextResponse.json({ ok: true, reviewUrl: rating === 'loved' ? info.reviewUrl : null });
  }
  if (b.action === 'confirm') {
    if (!info.case) return bad('Nothing to confirm yet.');
    return NextResponse.json(await clientConfirm(db, tenantId, info.case.id, b.good !== false, String(b.words || '')));
  }
  if (['redo_times', 'book_redo', 'redo_none'].includes(b.action)) {
    if (!info.case?.redo) return bad('There’s no redo to book.');
    if (!info.case.redo.canChange) return bad('This redo can’t be changed online — please message us.');
    const c: any = (await db.doc(`tenants/${tenantId}/cases/${info.case.id}`).get()).data();
    if (b.action === 'redo_times') { const { redoTimes } = await import('@/lib/redo-times'); const r = await redoTimes(db, tenantId, c, { others: !!b.others, from: b.from });
      return NextResponse.json({ ok: r.ok, minutes: r.minutes, error: r.error, providers: r.providers.map((p) => ({ staffId: p.staffId, name: String(p.name).split(' ')[0], original: p.original, days: p.days })) }); }
    if (b.action === 'redo_none') return NextResponse.json(await redoNone(db, tenantId, c, String(b.note || '')));
    const r = await bookRedo(db, tenantId, c, { staffId: String(b.staffId || ''), date: String(b.date || ''), time: String(b.time || ''), by: c.clientName || 'Client', byClient: true });
    return NextResponse.json(r, { status: r.ok ? 200 : 409 });
  }
  if (!info.open) return bad('This visit can’t take a report here any more — please call us.');
  if (info.case) return bad('We already have your report for this visit.');

  if (b.action === 'upload') {
    const count = Number((v.a.feedbackUploads || 0)); if (count >= 8) return bad('That’s the most files we can take for one visit.');
    const r = await uploadClaimPhotoFromDataUrl(tenantId, id, b.dataUrl, 'cases');
    if (!r.url) return bad(r.error || 'That didn’t upload.');
    await v.ref.set({ feedbackUploads: count + 1 }, { merge: true });
    return NextResponse.json({ ok: true, url: r.url });
  }
  if (b.action === 'report') {
    const mine = (u: any) => typeof u === 'string' && u.startsWith('https://firebasestorage.googleapis.com/') && u.includes(encodeURIComponent(`tenants/${tenantId}/cases/${id}/`));
    const photos = (Array.isArray(b.photos) ? b.photos : []).filter(mine).slice(0, 6);
    const lang = String(b.lang || 'en').slice(0, 2).toLowerCase(); const words = String(b.words || '').trim().slice(0, 2000);
    const voice = b.voice && mine(b.voice.url) ? { url: b.voice.url, transcript: String(b.voice.transcript || '').slice(0, 4000) || null, language: lang, seconds: Number(b.voice.seconds) || null, translation: null as string | null } : null;
    let wordsEn: string | null = null;
    if (lang !== 'en' && (words || voice?.transcript)) {
      try { const { translateTexts } = await import('@/lib/translate'); const out = await translateTexts(tenantId, [words, voice?.transcript || ''], 'en');
        wordsEn = words && out[0] !== words ? out[0] : null; if (voice?.transcript && out[1] !== voice.transcript) voice.translation = out[1]; } catch { /* the team still sees the original */ }
    }
    const actor: any = { staffId: 'client', name: String(v.a.clientName || 'Client'), role: 'client', isManager: false, isOwner: false, portal: false, caps: [] };
    const r = await openCase(db, tenantId, actor, { via: b.via === 'link' ? 'link' : 'survey', appointmentId: id, clientId: v.a.clientId || '', clientName: v.a.clientName || '', reasonId: b.reasonId, words, wordsEn, wordsLang: lang !== 'en' ? lang : null,
      wants: b.wants, photos, voice, statusPath: feedbackPath(tenantId, id) });
    if (!r.ok) return bad(r.error);
    await v.ref.set({ feedback: { rating: 'not_right', at: now, caseId: r.id } }, { merge: true });
    return NextResponse.json({ ok: true, number: r.number });
  }
  return bad('Unknown action.');
}
