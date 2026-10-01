// src/lib/support-brief.ts — "COPY FOR CLAUDE": turns a help-desk ticket into a ready-to-paste troubleshooting brief.
// Everything a developer (or Claude) needs in one block: who, what they said, the account-check findings, what loaded
// and what was refused, the device and recent errors — plus WHERE TO LOOK, mapped from each known finding to the code
// that owns it, and the known causes so a repeat problem is recognised at once. HQ-only (built in the admin view).
const WHERE: Record<string, string> = {
  no_business: 'Ownership lookup — src/app/api/my-tenants/route.ts (checks tenants.userId, users/{uid}.tenantId, ownerId/ownerUid, verified email) and src/lib/my-tenants-client.ts; fix: the tenant doc needs userId = the owner\'s uid.',
  access: 'Firestore security rules — firestore.rules. Areas without their own rule fall to the catch-all `match /tenants/{tenantId}/{collection}/{rest=**}`; check the live rules start with rules_version = \'2\' and that the collection isn\'t in the exclusion list. Also isStaff(): tenants/{id}.userId must equal the user\'s uid, or a staff/{uid} doc must exist.',
  no_location: 'Locations — src/context/LocationContext.tsx (lists business locations: has timezone, no locationTypeId), src/app/api/locations/repair/route.ts (restores `primary`).',
  dupes: 'Duplicate locations — merge via Settings → Locations (src/app/api/locations/delete/route.ts, mode merge).',
  stale_location: 'Device remembers a deleted location — localStorage selectedLocationId; LocationContext falls back to the first active location.',
  dropped: 'Data loaded then vanished — usually a Firestore listener refused AFTER the cached copy showed (permission-denied → useCollection clears data). Compare the refused areas with firestore.rules; also check the role (non-owners see only staff.locationIds).',
  orders_waiting: 'Online orders stuck at "placed" — src/app/api/cron/retail-payments/route.ts (every 5 min, CRON_SECRET), src/lib/retail-payment-check.ts, webhook branch in src/app/api/stripe/connect-webhook/route.ts (handleRetailOrderPaid).',
};
const KNOWN = [
  'Areas refused while appointments/clients load → the catch-all rule (fixed 2026-10-01: recursive wildcard has no .size(); must use {collection}/{rest=**}).',
  'Owner sees nothing / wrong business → tenants.userId missing (fixed by /api/my-tenants self-repair) or a stale selectedTenantId.',
  'React error #300/#310 → a hook after an early return; run the whole-app hook scan.',
  'Paid online orders not on the board → webhook branch missing or cron not running (check CRON_SECRET in Vercel).',
];

export function ticketBrief(k: any): string {
  const h = k?.context?.health || null; const c = k?.context || {};
  const L: string[] = [];
  L.push(`# ClarityFlow support ticket — ${k?.subject || 'untitled'}`);
  L.push(`Business: ${k?.tenantName || '—'} (${k?.tenantId || '—'})${k?.businessType ? ` · ${k.businessType}` : ''}`);
  L.push(`From: ${k?.contactName || '—'} <${k?.contactEmail || '—'}> · ${k?.createdAt || ''} · kind ${k?.kind || '—'} · priority ${k?.priority || '—'} · status ${k?.status || '—'}`);
  L.push('', '## What they said', String(k?.message || '').trim() || '—');
  const thread = (k?.thread || []).filter((m: any) => m?.message).slice(-6);
  if (thread.length) { L.push('', '## Conversation (latest)'); for (const m of thread) L.push(`- ${m.from === 'hq' ? 'HQ' : 'Customer'}: ${String(m.message).slice(0, 400)}`); }
  if (h) {
    L.push('', `## Account check — ${h.summary || ''}`);
    for (const f of h.findings || []) L.push(`- [${f.level}] ${f.text}${f.key ? ` (${f.key})` : ''}`);
    L.push(`- Business picked: ${h.business?.tenantId || '—'} · role ${h.business?.role || '—'} · server says user owns: ${(h.business?.serverOwned || []).join(', ') || 'nothing'}${h.business?.staff ? ` · staff: ${h.business.staff}` : ''}`);
    const reads = Object.entries(h.reads || {}).map(([a, r]: any) => `${a} ${r.ok ? `✓(${r.count})` : `✗ ${r.code || 'refused'}`}`);
    if (reads.length) L.push(`- Test reads: ${reads.join(' · ')}`);
    L.push(`- Locations: ${h.locations?.count ?? '—'} (${h.locations?.duplicates ?? 0} duplicate) · device remembers ${h.locations?.storedOnDevice || '—'} · online orders waiting: ${h.waitingOrders || 0}`);
    if ((h.timeline || []).length) { L.push('- Timeline (first 15 s on their device):'); for (const x of h.timeline) L.push(`    ${x}`); }
  }
  L.push('', '## Device & context', `- Page: ${c.page || '—'} · app ${c.appVersion || '—'} on ${c.host || '—'} · screen ${c.screen || '—'}`, `- Device: ${c.userAgent || '—'}`);
  for (const e of (c.errors || []).slice(-10)) L.push(`- Error: ${e.message} (${e.page || ''} ${e.at || ''})`);
  if (k?.ai?.summary) L.push('', '## HQ AI notes', `- ${k.ai.summary}`, k.ai.likelyCause ? `- Likely cause: ${k.ai.likelyCause}` : '');
  const keys = new Set<string>((h?.findings || []).filter((f: any) => f.level !== 'ok').map((f: any) => f.key));
  if (keys.size) { L.push('', '## Where to look'); for (const key of keys) if (WHERE[key]) L.push(`- ${key}: ${WHERE[key]}`); }
  L.push('', '## Known causes (check these first)'); for (const x of KNOWN) L.push(`- ${x}`);
  L.push('', '## What I need', 'Repo: github.com/opalmanicurestudio-hub/studio (Next.js App Router + Firebase/Firestore + Stripe Connect, deployed on Vercel).',
    'Diagnose the root cause from the evidence above, confirm it against the code, then give the fix as complete files (or exact Firestore-console / rules steps if it is configuration). Say what the customer should do afterwards, and whether other businesses could be affected.');
  return L.filter((x) => x !== undefined).join('\n');
}
