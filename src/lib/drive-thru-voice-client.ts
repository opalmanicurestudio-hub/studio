'use client';
// src/lib/drive-thru-voice-client.ts — THE VOICE SERVICE'S BROWSER KIT, pointed at our own server (L21). The kit runs a
// call on the speaker tablet and listens in or takes over from the lane screen, but it never talks to the service
// directly: every request it makes is sent to api/counter/voice instead, which adds the secret key and only ever lets
// this business reach its own calls. The kit is loaded only on the screens that use it.
//   The live transcript needs the service's public key (restricted to this site); without one, listening in and taking
//   over still work, just without the words on screen.

type Ctx = { tenantId: string; key: string | null; carId?: string | null; staffPass?: string | null };

/** A fetch for the kit: its call to make a web call becomes "start this car's call", and its live-call steps become
 *  "do this to one of our calls", both answered by our server with the service's own reply. */
export function proxiedFetch(ctx: () => Ctx): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const body = init?.body ? (() => { try { return JSON.parse(String(init.body)); } catch { return {}; } })() : {};
    const c = ctx();
    let payload: any;
    if (url.pathname === '/v3/create-web-call') payload = { action: 'start', carId: c.carId };
    else {
      const m = url.pathname.match(/^\/v2\/(listen-live-call|take-over-live-call|update-live-call|stop-call)\/([^/]+)$/);
      if (!m) return new Response(JSON.stringify({ message: 'Not available here.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      payload = { action: 'op', op: m[1], callId: decodeURIComponent(m[2]), body };
    }
    const r = await fetch('/api/counter/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: c.tenantId, key: c.key, ...(c.staffPass ? { staffPass: c.staffPass } : {}), ...payload }) });
    const text = await r.text();
    return new Response(text, { status: r.status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

/** The kit's client, made only when it's needed (it brings its own audio code). */
export async function voiceClient(ctx: () => Ctx, publicKey: string | null) {
  const { RetellClient } = await import('retell-client-js-sdk');
  return new RetellClient({ key: publicKey || 'proxied', fetch: proxiedFetch(ctx) });
}

/** A transcript line for the screen: who spoke and what they said (tool calls and the like are left out). */
export function spoken(items: any[]): { id: string; who: 'guest' | 'assistant'; text: string }[] {
  return (Array.isArray(items) ? items : []).filter((x) => (x?.role === 'user' || x?.role === 'agent') && String(x?.content || '').trim())
    .map((x) => ({ id: String(x.id || ''), who: x.role === 'user' ? 'guest' as const : 'assistant' as const, text: String(x.content).trim() }));
}
