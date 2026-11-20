// src/lib/rewards-code.ts — A MEMBER'S REWARDS CODE (server; design canvas "Rewards at the drive-thru"): six digits on
// their own rewards page, new every CODE_MIN minutes, that they say at the speaker or show at the window so the order is
// theirs and they can use a reward. A phone number anyone overheard only earns points; spending them takes this code, and
// a code overheard is no use a few minutes later. The one just before still works, so a code read out as it changes
// isn't turned away.
//   Worked out from a secret, the business, the member and the time (never stored on the page), and kept only as a
//   lookup from the code to the member: rewardCodes/{tenantId}_{window}_{code} = { tenantId, clientId, window, expiresAt },
//   at the top of the database, server only. Two members with the same digits in the same window: the second gets the
//   next digits the secret gives them.
import { createHmac } from 'crypto';

export const CODE_MIN = 5;
const W = CODE_MIN * 60000;
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const secret = () => String(process.env.REWARDS_CODE_SECRET || process.env.CRON_SECRET || process.env.ORDER_TRACK_SECRET || '');
export const windowOf = (now = Date.now()) => Math.floor(now / W);
/** Whether codes can be given out here (a secret is set). */
export const codesOn = () => !!secret();

function digits(tenantId: string, clientId: string, w: number, n: number): string {
  const h = createHmac('sha256', secret()).update(`rc:${tenantId}:${clientId}:${w}:${n}`).digest();
  return String(h.readUInt32BE(0) % 1000000).padStart(6, '0');
}

/** The member's code now, and when the next one starts. Asked again in the same few minutes: the same code. */
export async function issueCode(db: any, tenantId: string, clientId: string, now = Date.now()): Promise<{ code: string; until: string } | null> {
  if (!codesOn() || !ID.test(tenantId) || !ID.test(clientId)) return null;
  const w = windowOf(now);
  for (let n = 0; n < 6; n++) {
    const code = digits(tenantId, clientId, w, n);
    const ref = db.doc(`rewardCodes/${tenantId}_${w}_${code}`); const before = db.doc(`rewardCodes/${tenantId}_${w - 1}_${code}`);
    const mine = await db.runTransaction(async (tx: any) => {
      const x: any = (await tx.get(ref)).data(); const b: any = (await tx.get(before)).data();
      // (The same digits still good for someone else from the few minutes before: theirs, until it runs out.)
      if (b && b.clientId !== clientId) return false;
      if (x) return x.clientId === clientId;
      tx.set(ref, { tenantId, clientId, window: w, expiresAt: new Date((w + 2) * W).toISOString() });
      return true;
    });
    if (mine) return { code, until: new Date((w + 1) * W).toISOString() };
  }
  return null;
}

/** Whose code this is, if it's this window's or the one just before; otherwise nobody. */
export async function memberByCode(db: any, tenantId: string, code: unknown, now = Date.now()): Promise<string | null> {
  const c = String(code ?? '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(c) || !ID.test(tenantId)) return null;
  const w = windowOf(now);
  for (const x of [w, w - 1]) {
    const d: any = (await db.doc(`rewardCodes/${tenantId}_${x}_${c}`).get()).data();
    if (d && d.tenantId === tenantId && d.window === x && ID.test(String(d.clientId || ''))) return String(d.clientId);
  }
  return null;
}
