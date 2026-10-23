// src/lib/reader-settle.ts — ASKING THE SERVER ABOUT A CARD READER PAYMENT UNTIL A REAL ANSWER ARRIVES (browser).
// Capturing a reader payment is safe to repeat (lib/reader-sale), so when the connection drops the screen asks again
// rather than telling the desk it failed: a payment that went through is never shown as failed and charged again.
// `reached`: a real answer came back (paid, or not charged). Not reached: we don't know yet, so the desk checks again
// or cancels the payment before taking another.
export async function settleReader(
  send: (body: any) => Promise<{ status: number; json: () => Promise<any> }>,
  body: any,
  tries = 4,
  pause: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<{ data: any | null; reached: boolean }> {
  let last: any = null;
  for (let i = 0; i < tries; i++) {
    if (i) await pause(800 * 2 ** (i - 1));
    try {
      const res = await send(body);
      const data = await res.json().catch(() => null);
      if (data?.ok) return { data, reached: true };
      if (data && res.status === 202) { last = data; continue; }   // still being processed: ask again
      if (data && res.status < 500) return { data, reached: true };
    } catch { /* the connection dropped: ask again */ }
  }
  return { data: last, reached: false };
}
