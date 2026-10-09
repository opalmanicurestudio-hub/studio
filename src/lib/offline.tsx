'use client';
// src/lib/offline.ts — WORKING WITHOUT SIGNAL (back rooms, laundry, basements). The app keeps a copy of the data on the
// device, so scans and taps still show straight away and are sent when the signal comes back. Saving normally waits for
// the server to confirm; offline that would leave buttons spinning, so `settle` lets the screen carry on and the save
// goes through by itself later. `useOnline` drives the "Offline — saved on this phone" note.
import * as React from 'react';

export const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
export function settle<T>(p: Promise<T>): Promise<T | undefined> { if (isOffline()) { p.catch(() => undefined); return Promise.resolve(undefined); } return p; }
export function useOnline(): boolean {
  const [on, setOn] = React.useState(() => !isOffline());
  React.useEffect(() => { const up = () => setOn(true), down = () => setOn(false); window.addEventListener('online', up); window.addEventListener('offline', down); return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); }; }, []);
  return on;
}
export function OfflineNote() {
  const on = useOnline(); if (on) return null;
  return <p role="status" className="rounded-2xl bg-[#FDF1DC] px-4 py-3 text-[14px] font-[600] text-[#7A4A00]">Offline — scans and taps are saved on this device and will send when you’re back online.</p>;
}
