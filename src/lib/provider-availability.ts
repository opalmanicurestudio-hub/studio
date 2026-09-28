// src/lib/provider-availability.ts — server helper: is a provider free for a time range?
/** Is this provider free for [start, end)? (ignores cancelled/finished bookings) */
export async function providerFree(db: any, T: string, staffId: string, startMs: number, endMs: number, ignoreId?: string) {
  const q = await db.collection(`${T}/appointments`).where('staffId', '==', staffId).get();
  return !q.docs.some((d: any) => {
    if (d.id === ignoreId) return false;
    const o = d.data() as any; if (['cancelled', 'completed', 'no_show', 'declined', 'expired'].includes(String(o.status || ''))) return false;
    const s = Date.parse(o.startTime), e = Date.parse(o.endTime || o.startTime);
    return Number.isFinite(s) && s < endMs && e > startMs;
  });
}
