'use client';
// src/lib/device.ts — this browser's device id (for "approved devices only").
export function deviceId(): string {
  try { let id = localStorage.getItem('cf_device_id'); if (!id) { id = (crypto as any).randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('cf_device_id', id!); } return id!; } catch { return 'unknown'; }
}
export function deviceName(): string {
  if (typeof navigator === 'undefined') return 'Device';
  const ua = navigator.userAgent; const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'browser';
  return `${os} · ${br}`;
}
