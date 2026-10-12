// src/lib/text-intent.ts — a first read of a client's text from the words alone (no model, no database).
// Used by lib/text-assist on the server and by the practice game in the browser.
export type Intent = 'cancel' | 'reschedule' | 'late' | 'confirm' | 'question' | 'other';
/** A first read from the words alone. `sure` = a one-word keyword, no interpretation needed. */
export function intentByWords(body: string): { intent: Intent; sure: boolean } {
  const s = String(body || '').trim().toLowerCase().replace(/[.!]+$/, '');
  if (/^(c|confirm|confirmed|yes|y|yes please|confirming)$/.test(s)) return { intent: 'confirm', sure: true };
  if (/^(x|cancel)$/.test(s)) return { intent: 'cancel', sure: true };
  if (/\bcancel/.test(s)) return { intent: 'cancel', sure: false };
  if (/\b(reschedul|re-schedul|move (my|the|it)|change (my|the) (time|appointment|appt|day)|different (time|day)|another (time|day)|push (it|my)|can i come (in )?(at|on)|switch (my|the) (time|day))/.test(s)) return { intent: 'reschedule', sure: false };
  if (/\b(running late|run(ning)? behind|i'?ll be late|be a (few|little) (min|minutes) late|stuck in traffic|be there in \d+|late\b)/.test(s)) return { intent: 'late', sure: false };
  if (/\?/.test(s)) return { intent: 'question', sure: false };
  return { intent: 'other', sure: false };
}

