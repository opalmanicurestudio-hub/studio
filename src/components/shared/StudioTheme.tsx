'use client';
// src/components/shared/StudioTheme.tsx — THE APP-WIDE STUDIO LOOK.
// Adds `studio` to <html> (see globals.css) unless the business chose the
// Classic look, and paints buttons/active states in the business's accent —
// only when white text on it stays readable (WCAG 4.5:1); otherwise ink.
import { useEffect } from 'react';
import { useTenant } from '@/context/TenantContext';

/** The business's accent: their booking-page colour (same one the front desk uses). */
export function accentOf(t: any): string | null {
  const c = t?.bookingPageSettings?.cfPageConfig?.accentColor || t?.bookingPageSettings?.theme?.primaryColor || t?.brandColor || null;
  return typeof c === 'string' && /^#?[0-9a-f]{6}$/i.test(c.trim()) ? (c.trim().startsWith('#') ? c.trim() : `#${c.trim()}`) : null;
}
function hexToRgb(h: string) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function luminance([r, g, b]: number[]) { const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }
/** "h s% l%" for the CSS variables, if white text on it passes 4.5:1. */
export function accentHsl(hex: string | null): string | null {
  if (!hex) return null; const rgb = hexToRgb(hex);
  if ((1.05) / (luminance(rgb) + 0.05) < 4.5) return null;       // too light for white text
  const [r, g, b] = rgb.map((v) => v / 255); const max = Math.max(r, g, b), min = Math.min(r, g, b); const l = (max + min) / 2;
  let h = 0, s = 0; if (max !== min) { const d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export function StudioTheme() {
  const { selectedTenant } = useTenant() as any;
  const on = (selectedTenant as any)?.appAppearance !== 'classic';
  const hsl = accentHsl(accentOf(selectedTenant));
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('studio', on);
    const vars = ['--primary', '--ring', '--sidebar-primary', '--sidebar-ring'];
    if (on && hsl) { vars.forEach((v) => root.style.setProperty(v, hsl)); root.style.setProperty('--primary-foreground', '0 0% 100%'); root.style.setProperty('--sidebar-primary-foreground', '0 0% 100%'); }
    else { vars.forEach((v) => root.style.removeProperty(v)); root.style.removeProperty('--primary-foreground'); root.style.removeProperty('--sidebar-primary-foreground'); }
    return () => { root.classList.remove('studio'); [...vars, '--primary-foreground', '--sidebar-primary-foreground'].forEach((v) => root.style.removeProperty(v)); };
  }, [on, hsl]);
  return null;
}
