// src/lib/digital-notices.ts — THE MESSAGES A DOWNLOAD SENDS AFTER IT'S BOUGHT (pure). The receipt already carries the
// library link (lib/retail-webhook). Beyond it:
//   · access ending soon: once per end date, a few days before a window closes (an extension moves the date, so the
//     buyer hears again before the new end), never for access that's closed already;
//   · a new version of a file: when the shop asks, once per buyer per file version, to whoever can still open it;
//   · a file the buyer can't open (missing or never attached): the team is told, once per item a day.
// Each goes to whoever the access record belongs to: the buyer, or the person a gift was for (lib/digital-gift).

const DAY = 86400e3;

/** How long before the end the reminder goes: a week, or a quarter of a short window (never under a day). */
export function endingLeadMs(startsAt: string | null | undefined, endsAt: string): number {
  const start = Date.parse(String(startsAt || '')); const end = Date.parse(endsAt);
  const span = Number.isFinite(start) && end > start ? end - start : 30 * DAY;
  return Math.min(7 * DAY, Math.max(DAY, Math.floor(span / 4)));
}

/**
 * Whether the "ending soon" email is due for a record, given where it stands now by the one access rule
 * (lib/digital-access-rule): open, with an end date, inside the lead time, and not already sent for that end.
 */
export function endingDue(ent: any, access: { open: boolean; endsAt: string | null }, now: number): boolean {
  if (!ent || ent.status === 'revoked' || !access.open || !access.endsAt) return false;
  const end = Date.parse(access.endsAt);
  if (!Number.isFinite(end) || end <= now) return false;
  if (String(ent.notices?.endingFor || '') === access.endsAt) return false;
  return end - now <= endingLeadMs(ent.access?.startsAt, access.endsAt);
}

const day = (iso: string, timeZone = 'UTC') => { try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone }); } catch { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); } };
const dl = (n: number | null) => (n === null ? '' : n === 0 ? ' You have no downloads left, but you can still read it online until then.' : ` You have ${n} download${n === 1 ? '' : 's'} left if you'd like a copy to keep.`);

/** `timeZone` is the shop's, so the day named is the one the shop's customers live in. */
export function endingMessage(product: string, shop: string, endsAt: string, left: number | null, gift = false, timeZone = 'UTC'): { subject: string; line: string; ask: string } {
  return {
    subject: `Your access to ${product} ends ${day(endsAt, timeZone)}`,
    line: `Your access to ${product} from ${shop} ends on ${day(endsAt, timeZone)}.${dl(left)}`,
    ask: gift ? 'Need more time? Reply to this email to ask the shop.' : 'Need more time? Send the shop a message from your order page.',
  };
}

/**
 * The files a save changed: those whose version went up, by id. An added file isn't an update. A product's single file
 * from before files had versions ('main') gets a new id when it's replaced, so that one replacement counts too.
 */
export function changedFiles(before: { id: string; version: number }[], after: { id: string; version: number; name: string }[]): { id: string; version: number; name: string }[] {
  const was = new Map(before.map((f) => [f.id, f.version]));
  const legacy = before.length === 1 && before[0].id === 'main';
  // A file added in the same save starts at version 1, so only the replacement (version 2 and up) counts.
  return after.filter((f) => (was.has(f.id) ? (was.get(f.id) ?? 0) < f.version : legacy && f.version >= 2));
}

/** Whether a record still needs the email about these file versions (each version once). */
export function updateDue(ent: any, files: { id: string; version: number }[]): boolean {
  const sent = ent?.notices?.updated || {};
  return files.some((f) => Number(sent[f.id] || 0) < f.version);
}

export function updateMessage(product: string, shop: string, files: { name: string }[], gift = false): { subject: string; line: string; cta: string } {
  const what = files.length === 1 ? `a new version of ${files[0].name}` : `new versions of ${files.length} files (${files.map((f) => f.name).join(', ')})`;
  return {
    subject: `${product} has been updated`,
    line: `${shop} added ${what} to ${product}. It's in your library now, at no extra cost.`,
    cta: gift ? 'Open my gift' : 'Open my library',
  };
}

/** The team's alert for a file a buyer couldn't open, and the marker that keeps it to once per item a day. */
export function missingAlert(product: string, why: 'missing' | 'unattached'): string {
  return why === 'unattached'
    ? `A buyer tried to open ${product}, but it has no file or link yet. Add one in the product's Digital section so it opens for everyone who bought it.`
    : `A buyer couldn't open a file on ${product}: it couldn't be fetched from storage. If it keeps happening, upload it again as a new version in the product's Digital section.`;
}
export const missingKey = (productId: string, today: string) => `digital_missing_${String(productId).replace(/[^A-Za-z0-9_-]/g, '')}_${today}`;
