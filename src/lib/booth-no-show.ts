// src/lib/booth-no-show.ts — THE BOOTH NO-SHOW FEE, ON A FIELD OF ITS OWN.
// The booth fee ({ enabled, feeCents }) used to be saved at `noShowPolicy`, the same field as the booking no-show
// policy clients read (text), so saving one replaced the other. It now lives at `boothNoShowPolicy`. A fee object
// left at `noShowPolicy` by the old save is still read here, and the next booth save moves it off that field.

export type BoothNoShowPolicy = { enabled: boolean; feeCents: number };

/** The booth no-show fee for a business: its own field first, then an object the old save left behind. */
export function boothNoShowPolicyOf(t: any): BoothNoShowPolicy {
  const own = t?.boothNoShowPolicy;
  const old = t?.noShowPolicy;
  const p = own && typeof own === 'object' ? own : old && typeof old === 'object' ? old : null;
  return { enabled: !!p?.enabled, feeCents: Math.max(0, Math.round(Number(p?.feeCents) || 0)) };
}

/** True when `noShowPolicy` holds a booth fee object instead of the booking policy's words. */
export function hasOldBoothFee(t: any): boolean {
  const old = t?.noShowPolicy;
  return !!old && typeof old === 'object';
}

/** The booking no-show policy as the words clients read: '' when what's stored isn't text. */
export function noShowWords(t: any): string {
  return typeof t?.noShowPolicy === 'string' ? t.noShowPolicy : '';
}
