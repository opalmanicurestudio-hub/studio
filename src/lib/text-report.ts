// src/lib/text-report.ts — THE EVENING TEXT REPORT. Once a day from 7pm (the business's time): every text that didn't
// reach someone today, in plain words and grouped by why, and everyone who replied STOP (or started texts again). Goes
// to the owner and managers as a notice, and to the owner by email. A day with nothing to report sends nothing.
const STOP = /^\s*(stop|stopall|unsubscribe|cancel|end|quit)\s*$/i, START = /^\s*(start|unstop)\s*$/i;
const ms = (v: any) => Date.parse(String(v || '')) || 0;

/** Why a text didn't go through, in words anyone can act on. */
export function failureWhy(m: any): string {
  const s = `${m.failureDetail || ''} ${m.error || ''}`;
  if (/STOP|21610|opted out/i.test(s)) return 'They had replied STOP';
  if (/30034|A2P/i.test(s)) return 'Texting registration not approved yet';
  if (/30006|landline/i.test(s)) return 'A landline, which can’t get texts';
  if (/21211|30005|invalid|unknown or inactive|typo/i.test(s)) return 'The number looks wrong';
  if (/30003|unreachable|switched off/i.test(s)) return 'Their phone was off or out of reach';
  if (/30007|spam|filtered/i.test(s)) return 'Their carrier blocked it as spam';
  if (/21608|trial/i.test(s)) return 'Texting account still on a trial';
  return 'Their carrier didn’t accept it';
}
export const FIXES: Record<string, string> = {
  'The number looks wrong': 'Check the number on their profile.',
  'A landline, which can’t get texts': 'Add a mobile number or an email for them.',
  'Texting registration not approved yet': 'Nothing reaches anyone until it’s approved.',
  'Their carrier blocked it as spam': 'Shorter texts without links get through more often.',
  'Texting account still on a trial': 'Upgrade the texting account so everyone can get texts.',
};

export type TextReport = { failed: number; groups: { why: string; fix: string | null; people: { name: string; kind: string }[] }[]; stopped: { name: string; word: string }[]; restarted: string[] };
export function buildTextReport(logs: any[], inbox: any[], since: number, until: number): TextReport {
  const failedLogs = logs.filter((m) => m.channel !== 'email' && ms(m.sentAt) >= since && ms(m.sentAt) < until && (m.status === 'failed' || m.bouncedAt) && !/replied STOP, so texts/.test(String(m.error || '')));
  const byWhy = new Map<string, { name: string; kind: string }[]>(); const seen = new Set<string>();
  for (const m of failedLogs) { const name = m.recipientName || m.clientName || m.to || 'Someone'; const k = `${name}|${m.kind}`; if (seen.has(k)) continue; seen.add(k);
    const why = failureWhy(m); (byWhy.get(why) || byWhy.set(why, []).get(why)!).push({ name, kind: String(m.kind || 'text').replace(/_/g, ' ') }); }
  const today = inbox.filter((i) => ms(i.at) >= since && ms(i.at) < until);
  return { failed: failedLogs.length, groups: [...byWhy.entries()].sort((a, b) => b[1].length - a[1].length).map(([why, people]) => ({ why, fix: FIXES[why] || null, people })),
    stopped: today.filter((i) => STOP.test(String(i.body || ''))).map((i) => ({ name: i.fromName || i.from || 'Someone', word: String(i.body || '').trim().toUpperCase() })),
    restarted: today.filter((i) => START.test(String(i.body || ''))).map((i) => i.fromName || i.from || 'Someone') };
}
export function reportLines(r: TextReport): string[] {
  const out: string[] = [];
  if (r.failed) out.push(`${r.failed} text${r.failed === 1 ? '' : 's'} didn’t reach ${r.failed === 1 ? 'someone' : 'people'} today.`);
  for (const g of r.groups) out.push(`${g.why}: ${g.people.slice(0, 8).map((p) => `${p.name} (${p.kind})`).join(', ')}${g.people.length > 8 ? ` and ${g.people.length - 8} more` : ''}.${g.fix ? ` ${g.fix}` : ''}`);
  if (r.stopped.length) out.push(`Replied STOP, so they won’t get texts from us now: ${r.stopped.map((s) => (s.word === 'STOP' ? s.name : `${s.name} (wrote “${s.word}”)`)).join(', ')}.${r.stopped.some((s) => s.word === 'CANCEL') ? ' “CANCEL” counts as STOP to the carrier, so if they meant their visit, reach them another way.' : ''}`);
  if (r.restarted.length) out.push(`Started texts again: ${r.restarted.join(', ')}.`);
  return out;
}

export async function textReportSweep(db: any, t: string, tenant: any, now = Date.now(), o: { force?: boolean; email?: (to: string, subject: string, lines: string[]) => Promise<boolean> } = {}) {
  const { tenantTimeZone, dayKey, hourIn } = await import('@/lib/tenant-time'); const tz = tenantTimeZone(tenant); const today = dayKey(new Date(now), tz);
  const ref = db.doc(`tenants/${t}/private/textReport`); const st: any = (await ref.get()).data() || {};
  if (!o.force && (hourIn(new Date(now), tz) < 19 || st.lastDay === today)) return { ok: true, skipped: 'not yet' };
  await ref.set({ lastDay: today, lastAt: new Date(now).toISOString() }, { merge: true });
  const since = Math.max(ms(st.lastAt) || 0, now - 24 * 3600e3); const iso = new Date(since).toISOString();
  const rows = (s: any) => s.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
  const [logs, inbox] = await Promise.all([db.collection(`tenants/${t}/messageLog`).where('sentAt', '>=', iso).get().then(rows).catch(() => []), db.collection(`tenants/${t}/smsInbox`).where('at', '>=', iso).get().then(rows).catch(() => [])]);
  const r = buildTextReport(logs, inbox, since, now + 1); const lines = reportLines(r);
  if (!lines.length) return { ok: true, sent: false, report: r };
  const staff = rows(await db.collection(`tenants/${t}/staff`).get()).filter((m: any) => !m.archived && ['owner', 'admin', 'manager'].includes(String(m.role || '')));
  const b = db.batch(); const at = new Date(now).toISOString();
  for (const m of staff) { const n = db.doc(`tenants/${t}/notifications/textreport_${today}_${m.id}`); b.set(n, { id: n.id, userId: m.id, type: 'text_report', link: '/message-log', read: false, createdAt: at, message: `Today’s texts: ${lines[0]}${lines.length > 1 ? ' Open for details.' : ''}` }); }
  await b.commit();
  const to = String(tenant.ownerEmail || tenant.email || tenant.contactEmail || '').trim(); let emailed = false;
  if (to.includes('@')) {
    if (o.email) emailed = await o.email(to, 'Today’s texts', lines);
    else { const { sendNotification } = await import('@/lib/notify'); const { brandedEmailHtml } = await import('@/lib/email-template'); const { linkOrigin } = await import('@/lib/app-origin'); const base = linkOrigin(tenant, '');
      const studio = String(tenant.name || 'Your business');
      emailed = !!(await sendNotification(db, { tenantId: t, channel: 'email', to, subject: `${studio}: today’s texts`, kind: 'text_report', recipientType: 'staff', text: lines.join('\n\n'),
        html: brandedEmailHtml({ studioName: studio, title: 'Today’s texts', bodyLines: lines, cta: base ? { label: 'Open the message log', url: `${base}/message-log` } : null, footerNote: 'Sent each evening only when a text didn’t go through or someone opted out.' }) }).catch(() => null))?.ok; }
  }
  return { ok: true, sent: true, emailed, report: r };
}
