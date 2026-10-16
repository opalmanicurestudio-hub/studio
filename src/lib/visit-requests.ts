// src/lib/visit-requests.ts — what a client is asked for before (and after) a visit, in plain words, and the message
// that carries the one visit link. Shared by the visit's "Send what's missing" / "Send to client" sheet and the send
// route (api/notifications/send-completion-link). Also: where a visit stands — one readiness check every screen uses,
// so a card, the planner sheet and the staff portal never disagree about forms, deposit or card.
import { readinessOf } from './visit-readiness';

export type RequestItem = 'forms' | 'photo_current' | 'inspo' | 'card' | 'deposit' | 'balance' | 'questions' | 'confirm' | 'photo_id' | 'emergency' | 'file';

export const ITEM_WORDS: Record<RequestItem, { ask: string; label: string }> = {
  forms: { ask: 'sign your form', label: 'Sign the form' },
  photo_current: { ask: 'add a photo of how things look now', label: 'A photo of how things look now' },
  inspo: { ask: 'share an inspiration photo', label: 'Inspiration photos' },
  card: { ask: 'save a card', label: 'Add a card' },
  deposit: { ask: 'pay your deposit', label: 'Pay the deposit' },
  balance: { ask: 'pay the balance', label: 'Pay the balance' },
  questions: { ask: 'answer a few quick questions', label: 'Before-visit questions' },
  confirm: { ask: 'confirm you’re coming', label: 'Confirm they’re coming' },
  photo_id: { ask: 'add a photo of your ID', label: 'Photo ID' },
  emergency: { ask: 'add an emergency contact', label: 'Emergency contact' },
  file: { ask: 'upload the file we asked for', label: 'A file' },
};

const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** The message that goes with the link: short for a text, a few lines for email. Professional, yet human. */
export function requestMessage(o: { firstName: string; studioName: string; startTime?: string; tzOffsetMinutes?: number; items: RequestItem[]; reason: 'requirements' | 'booking' | 'fee'; link: string }) {
  const off = Number.isFinite(Number(o.tzOffsetMinutes)) ? Number(o.tzOffsetMinutes) : -300;
  const t = o.startTime ? new Date(new Date(o.startTime).getTime() + off * 60000) : null;
  const when = t && !Number.isNaN(t.getTime()) ? `${t.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })} at ${t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })}` : null;
  const asks = o.items.map((i) => ITEM_WORDS[i]?.ask).filter(Boolean) as string[];
  if (o.reason === 'fee') return { title: `About your appointment with ${o.studioName}`, cta: 'See the details', lines: [`Hi ${o.firstName},`, 'Your appointment has been cancelled and a fee applies under our booking policy. The details, and how to settle it, are here.', `Kind regards, ${o.studioName}`], text: `Hi ${o.firstName}, your appointment with ${o.studioName} has been cancelled and a fee applies under our booking policy. The details are here: ${o.link}` };
  if (!asks.length) return { title: `Your visit with ${o.studioName}`, cta: 'Open my visit', lines: [`Hi ${o.firstName},`, `Here is the link for your visit${when ? ` on ${when}` : ''}. You can check in, let us know if you are running late, or make a change.`, `Kind regards, ${o.studioName}`], text: `Hi ${o.firstName}, here is the link for your visit with ${o.studioName}${when ? ` on ${when}` : ''}: ${o.link}` };
  const ask = list(asks);
  return { title: `Before your visit with ${o.studioName}`, cta: 'Do it now', lines: [`Hi ${o.firstName},`, `Before your visit${when ? ` on ${when}` : ''}, could you please ${ask}? It only takes a minute.`, `Thank you, ${o.studioName}`], text: `Hi ${o.firstName}, before your visit with ${o.studioName}${when ? ` on ${when}` : ''}, could you please ${ask}? It takes a minute: ${o.link}` };
}

// ── Readiness: one answer for every screen ──────────────────────────────────────────────────────────────────────
/** Forms this visit still needs: the service's required forms plus any extra ones added to the visit, less those signed
 *  on this visit, and less those the client signed before when the form doesn't have to be signed every time. */
export function pendingFormIds(apt: any, service: any, client?: any, forms?: any[]): string[] {
  const need = new Set<string>([...((service?.requiredFormIds || service?.consentFormIds || []) as string[]), ...((apt?.requiredFormIds || []) as string[]), ...((apt?.extraFormIds || []) as string[])]);
  const signedHere = new Set<string>((apt?.signedForms || []).map((f: any) => (typeof f === 'string' ? f : f?.formId || f?.id)).filter(Boolean));
  // Signed on an earlier visit: the client record's signedForms map (formId → { signedAt, everyVisit? }), or the
  // signedConsents list when a screen has loaded it.
  const map = client?.signedForms && !Array.isArray(client.signedForms) ? client.signedForms : {};
  const signedBefore = new Set<string>([...Object.keys(map), ...((client?.signedConsentIds || []) as string[])]);
  const everyTime = (id: string) => !!(forms || []).find((f: any) => f?.id === id)?.requiresEveryAppointment || !!map[id]?.everyVisit;
  return [...need].filter((id) => !signedHere.has(id) && (everyTime(id) || !signedBefore.has(id)));
}
export const intakeComplete = (apt: any) => ['complete', 'completed'].includes(String(apt?.completionStatus || ''));
/** What stops this visit starting, in plain words; null = ready. The rules are the business's (lib/readiness:
 *  Settings → Before a visit, and per service); this adds the visit's own state (finished, waiting to pay, a request). */
export function startBlocker(apt: any, service: any, client?: any, forms?: any[], tenant?: any): string | null {
  if (!apt) return null;
  const st = String(apt.status || '');
  if (['completed', 'cancelled', 'no_show', 'no-show', 'in_progress', 'in-progress', 'servicing', 'ready_for_checkout', 'checked_out', 'paid', 'requested', 'declined', 'expired'].includes(st)) return st === 'requested' ? 'Accept the booking first' : 'This visit can’t be started';
  return readinessOf(apt, service, client, tenant, forms).blocker;
}
