/**
 * retell-client — shared helper for placing outbound Retell calls.
 * Used by /api/voice/outbound-call (staff-triggered cancel/reschedule) and
 * /api/voice/send-reminders (cron-triggered). One place for the API shape,
 * so a Retell API change is a one-file fix.
 */

const RETELL_CREATE_CALL_URL = 'https://api.retellai.com/v2/create-phone-call';

export async function placeRetellCall(opts: {
  fromNumber: string;
  toNumber: string;
  dynamicVariables: Record<string, string>;
  metadata?: Record<string, any>;
}): Promise<{ ok: boolean; callId?: string; error?: string }> {
  if (!process.env.RETELL_API_KEY) {
    return { ok: false, error: 'RETELL_API_KEY not configured' };
  }
  try {
    const res = await fetch(RETELL_CREATE_CALL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from_number: opts.fromNumber,
        to_number: opts.toNumber,
        ...(process.env.RETELL_OUTBOUND_AGENT_ID
          ? { override_agent_id: process.env.RETELL_OUTBOUND_AGENT_ID }
          : {}),
        retell_llm_dynamic_variables: opts.dynamicVariables,
        metadata: opts.metadata || {},
      }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data?.message || `Retell responded ${res.status}` };
    }
    return { ok: true, callId: data?.call_id || undefined };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'network_error' };
  }
}
