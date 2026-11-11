// src/lib/drive-thru-voice.ts — THE DRIVE-THRU'S VOICE ASSISTANT, on the server (L21). Whether it's on here (the voice
// service's key and an assistant are set, and the business hasn't switched it off on the Menu page), and a call ended
// from the server side: when the service says so (api/voice/call-events), or when the car it's talking to is gone
// (handed over, left, voided), so the assistant never keeps talking to an empty lane.

const RETELL = 'https://api.retellai.com';
const CALL = /^[A-Za-z0-9_-]{6,128}$/;

/** The assistant this business uses: its own, or the one set up for every business. */
export const agentOf = (tenant: any) => String(tenant?.driveThru?.voiceAgentId || process.env.RETELL_DRIVETHRU_AGENT_ID || '').trim();
/** On here: the service's key and an assistant are set, and the business hasn't switched it off. */
export const voiceOn = (tenant: any) => !!process.env.RETELL_API_KEY && !!agentOf(tenant) && tenant?.driveThru?.voice !== false;

/** A call is over: kept on the call and on its car (with who took over, if anyone did). Safe to call twice. */
export async function markCallEnded(db: any, callId: string, why: string): Promise<void> {
  if (!CALL.test(callId)) return;
  const ref = db.doc(`driveThruCalls/${callId}`);
  const call: any = (await ref.get()).data(); if (!call) return;
  const nowIso = new Date().toISOString();
  const carRef = /^[A-Za-z0-9_-]{1,160}$/.test(String(call.carId || '')) && /^[A-Za-z0-9_-]{1,160}$/.test(String(call.tenantId || '')) ? db.doc(`tenants/${call.tenantId}/driveThruCars/${call.carId}`) : null;
  await db.runTransaction(async (tx: any) => {
    const c: any = carRef ? (await tx.get(carRef)).data() : null;
    if (call.status !== 'ended') tx.set(ref, { status: 'ended', endedAt: nowIso, endedWhy: why.slice(0, 60) }, { merge: true });
    if (c?.voice?.callId === callId && c.voice.status !== 'ended') tx.set(carRef, { voice: { ...c.voice, status: 'ended', endedAt: nowIso } }, { merge: true });
  });
}

/** Hang up a car's call from the server (the car is gone), if it has one still going. Never throws. */
export async function stopCarCall(db: any, tenantId: string, carId: string, why: string): Promise<void> {
  try {
    const car: any = (await db.doc(`tenants/${tenantId}/driveThruCars/${carId}`).get()).data();
    const callId = String(car?.voice?.callId || '');
    if (!CALL.test(callId) || !['live', 'taken_over', 'starting'].includes(String(car?.voice?.status))) return;
    if (process.env.RETELL_API_KEY && car.voice.status !== 'starting') {
      await fetch(`${RETELL}/v2/stop-call/${encodeURIComponent(callId)}`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.RETELL_API_KEY}` } }).catch(() => undefined);
    }
    await markCallEnded(db, callId, why);
  } catch (e: any) { console.error('[drive-thru-voice] stop', e?.message || e); }
}
