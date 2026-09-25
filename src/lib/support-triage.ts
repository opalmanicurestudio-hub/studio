// src/lib/support-triage.ts
//
// SORTING HELP REQUESTS — so the right one gets answered first.
//
// Every ticket gets a category, a priority and a response deadline (SLA).
// Plain rules do it instantly and always work; when AI is connected, Claude
// reads the request with its context (page, errors, the business's recent
// failures) and adds a one-line summary, the likely cause, whether a
// developer is needed, and a drafted reply for a human to approve.

import { askClaude, parseJson, aiConfigured } from '@/lib/ai';

export type Category = 'login' | 'payments' | 'booking' | 'messages' | 'renters' | 'data' | 'bug' | 'billing' | 'question' | 'idea';
export type Priority = 'urgent' | 'high' | 'normal' | 'low';

export const CATEGORY_LABEL: Record<Category, string> = {
  login: 'Sign-in', payments: 'Payments', booking: 'Booking', messages: 'Emails & texts', renters: 'Renters & rent',
  data: 'Data & import', bug: 'Bug', billing: 'Billing', question: 'Question', idea: 'Idea',
};
// First reply due within…
export const SLA_HOURS: Record<Priority, number> = { urgent: 1, high: 4, normal: 24, low: 72 };

const RULES: [Category, RegExp][] = [
  ['login', /log ?in|sign ?in|password|locked out|can'?t access|reset/i],
  ['payments', /stripe|payment|card|charge|refund|deposit|payout|tap to pay|checkout/i],
  ['booking', /book|appointment|calendar|slot|request|accept|decline|schedule|availability/i],
  ['messages', /text|sms|email|reminder|notification|message|didn'?t (get|receive)/i],
  ['renters', /renter|rent|lease|booth|suite|chair/i],
  ['data', /import|export|csv|missing|deleted|duplicate|lost/i],
  ['billing', /invoice|subscription|plan|price|billing/i],
];

export function ruleTriage(t: { message: string; kind: string; errors?: any[] }): { category: Category; priority: Priority } {
  const text = t.message || '';
  let category: Category = t.kind === 'idea' ? 'idea' : t.kind === 'question' ? 'question' : 'bug';
  for (const [c, re] of RULES) if (re.test(text)) { category = c; break; }
  const urgentWords = /(can'?t|cannot|unable).*(take|accept|process).*(pay|book)|locked out|nothing works|down|urgent|asap|losing (money|clients)|clients can'?t book/i;
  let priority: Priority = t.kind === 'idea' ? 'low' : t.kind === 'question' ? 'normal' : 'high';
  if (urgentWords.test(text)) priority = 'urgent';
  else if ((t.errors || []).length >= 3 && priority === 'normal') priority = 'high';
  if (category === 'login' && t.kind === 'broken') priority = 'urgent';
  return { category, priority };
}

export interface AiTriage { category: Category; priority: Priority; summary: string; likelyCause: string; needsDeveloper: boolean; suggestedReply: string }

const SYSTEM = `You are the first-line support analyst for ClarityFlow, a booking, payments, team and business-management app for salons, spas, fitness studios and small shops. Business owners (not technical) send help requests from inside the app. You get their message plus context: the page they were on, recent browser errors, and recent failures on their account.

Return ONLY a JSON object:
{"category": one of login|payments|booking|messages|renters|data|bug|billing|question|idea,
 "priority": one of urgent|high|normal|low  (urgent = they can't take bookings/payments or can't sign in; high = something important is broken; normal = questions and minor issues; low = ideas),
 "summary": one plain sentence, max 20 words,
 "likelyCause": one or two sentences on what is probably happening, based ONLY on the evidence given — say "Not enough information" if unclear,
 "needsDeveloper": true only if the evidence points to a bug in the app,
 "suggestedReply": a warm, plain-English reply to the owner, under 120 words, no jargon, no promises you can't keep; ask ONE clarifying question if needed; sign off "— ClarityFlow"}`;

export async function aiTriage(input: { message: string; kind: string; subject?: string; page?: string; errors?: any[]; tenantName?: string; recentFailures?: string[]; tenantId?: string }): Promise<AiTriage | null> {
  if (!aiConfigured()) return null;
  const prompt = [
    `Business: ${input.tenantName || 'unknown'}`,
    `They chose: ${input.kind}`,
    input.subject ? `Subject: ${input.subject}` : '',
    `Message: """${String(input.message).slice(0, 3000)}"""`,
    `Page: ${input.page || 'unknown'}`,
    `Recent browser errors: ${(input.errors || []).length ? input.errors!.map((e: any) => `- ${e.message} (${e.page})`).join('\n') : 'none'}`,
    `Recent failures on their account: ${(input.recentFailures || []).length ? input.recentFailures!.join('\n') : 'none'}`,
  ].filter(Boolean).join('\n');
  const r = await askClaude({ system: SYSTEM, prompt, tier: 'fast', maxTokens: 600, purpose: 'ticket_triage', tenantId: input.tenantId || null });
  if (!r.ok) return null;
  const j = parseJson<AiTriage>(r.text);
  if (!j) return null;
  const cats = Object.keys(CATEGORY_LABEL);
  return {
    category: (cats.includes(j.category) ? j.category : 'question') as Category,
    priority: (['urgent', 'high', 'normal', 'low'].includes(j.priority) ? j.priority : 'normal') as Priority,
    summary: String(j.summary || '').slice(0, 200), likelyCause: String(j.likelyCause || '').slice(0, 500),
    needsDeveloper: j.needsDeveloper === true, suggestedReply: String(j.suggestedReply || '').slice(0, 1500),
  };
}

/** A fresh AI draft for a reply, given the whole conversation so far. */
export async function aiDraftReply(input: { ticket: any; instructions?: string }) {
  const k = input.ticket;
  const convo = [`Owner (${k.contactName || 'owner'}): ${k.message}`, ...(k.thread || []).map((m: any) => `${m.from === 'hq' ? 'ClarityFlow' : 'Owner'}: ${m.message}`)].join('\n\n');
  return askClaude({
    system: 'You write replies for ClarityFlow support to small-business owners. Warm, clear, plain English, no jargon, under 150 words. Only state what the evidence supports. Sign off "— ClarityFlow". Return only the reply text.',
    prompt: `Conversation so far:\n${convo}\n\nContext: page ${k.context?.page || '?'}; errors: ${(k.context?.errors || []).map((e: any) => e.message).join('; ') || 'none'}.\nAI notes: ${k.ai?.likelyCause || 'none'}\n${input.instructions ? `Instructions from the support agent: ${input.instructions}` : ''}\n\nWrite the next reply from ClarityFlow.`,
    tier: 'smart', maxTokens: 500, purpose: 'ticket_draft', tenantId: k.tenantId || null,
  });
}
