'use client';
// src/lib/visit-client.ts — open a visit's ticket from anywhere (the host lives in the app shell), and let the page
// you're on offer its own actions to the ticket (the POS: take payment, cancel / no-show, booking details).
export function openVisit(appointmentId: string) { if (typeof window !== 'undefined' && appointmentId) window.dispatchEvent(new CustomEvent('cf:open-visit', { detail: { appointmentId } })); }
export interface VisitActions { checkout?: (id: string) => void; cancel?: (id: string) => void; details?: (id: string) => void; bookNext?: (id: string, clientId?: string | null, serviceId?: string | null) => void }
export function registerVisitActions(a: VisitActions) { if (typeof window === 'undefined') return () => {}; (window as any).cfVisitActions = a; return () => { if ((window as any).cfVisitActions === a) delete (window as any).cfVisitActions; }; }
export const visitActions = (): VisitActions => (typeof window !== 'undefined' ? (window as any).cfVisitActions || {} : {});
