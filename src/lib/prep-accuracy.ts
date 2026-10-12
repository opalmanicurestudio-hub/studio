// src/lib/prep-accuracy.ts — BEFORE THE VISIT: how accurate are clients' answers? (client and server safe)
// For past visits that were sent the check: did they answer, and did the provider find more on the day (a change the
// client agreed to in person — lib/prep-day)? By service, with a plain-words tip where answers often miss.
const DEAD = ['cancelled', 'canceled', 'no_show', 'declined', 'expired'];

export interface AccuracyRow { service: string; asked: number; answered: number; matched: number; moreAfterAnswer: number; moreNoAnswer: number }

/** "More found on the day": the client said yes in person to a change (they said no → it was still more than they told us). */
const moreOnDay = (a: any) => (Array.isArray(a?.dayChanges) ? a.dayChanges : a?.dayChange ? [a.dayChange] : []).length > 0;

export function accuracyOf(visits: any[], now = Date.now()) {
  const by = new Map<string, AccuracyRow>();
  for (const a of visits || []) {
    if (!a?.prepSentAt && !a?.prep) continue; if (DEAD.includes(String(a.status || ''))) continue;
    if (Date.parse(a.startTime) > now) continue;
    const name = String(a.serviceName || 'Visit'); const r = by.get(name) || { service: name, asked: 0, answered: 0, matched: 0, moreAfterAnswer: 0, moreNoAnswer: 0 };
    r.asked++; const answered = !!a.prep?.answeredAt; const more = moreOnDay(a);
    if (answered) { r.answered++; if (more) r.moreAfterAnswer++; else r.matched++; } else if (more) r.moreNoAnswer++;
    by.set(name, r);
  }
  const rows = [...by.values()].sort((x, y) => y.asked - x.asked);
  const tips: string[] = [];
  for (const r of rows) {
    if (r.answered >= 5 && r.moreAfterAnswer / r.answered >= 0.2) tips.push(`${r.service}: ${r.moreAfterAnswer} of ${r.answered} who answered needed more on the day — a photo question or a clearer option may help.`);
    if (r.asked >= 5 && r.answered / r.asked < 0.5) tips.push(`${r.service}: only ${r.answered} of ${r.asked} answered — the desk can fill it in with them by phone.`);
  }
  return { rows, tips: tips.slice(0, 4) };
}
