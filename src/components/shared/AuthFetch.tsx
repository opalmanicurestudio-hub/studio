'use client';
// src/components/shared/AuthFetch.tsx — EVERY CALL TO OUR OWN SERVER CARRIES THE SIGNED-IN PERSON'S TOKEN.
// Mounted once in the root layout. For requests to this app's /api/ routes that don't already set Authorization, it adds
// "Bearer <ID token>" when someone is signed in. Routes then decide who may do what (lib/route-guard). Requests to any
// other site are never touched; on public pages nobody is signed in, so nothing is added.
import { useEffect } from 'react';

export function AuthFetch() {
  useEffect(() => {
    const w = window as any; if (w.__cfAuthFetch) return; w.__cfAuthFetch = true;
    const original = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      try {
        const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
        const url = new URL(raw, window.location.href);
        if (url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
          const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
          if (!headers.has('authorization')) {
            const { getAuth } = await import('firebase/auth');
            const user = getAuth().currentUser;
            if (user) {
              headers.set('Authorization', `Bearer ${await user.getIdToken()}`);
              return input instanceof Request ? original(new Request(input, { ...init, headers })) : original(input, { ...init, headers });
            }
          }
        }
      } catch { /* no app or no user yet — send as it was */ }
      return original(input as any, init);
    };
  }, []);
  return null;
}
