'use client';
// src/components/shared/StudioTheme.tsx — THE APP-WIDE STUDIO LOOK.
// Adds `studio` to <html> (see globals.css): the app has one look, for every
// business. Paints buttons/active states in the business's accent: deepened
// just enough for white text on it (WCAG 4.5:1), or on the black look lightened
// just enough for dark text on it and for the color itself on black.
// Also applies white or true black (html.dark), this device's choice.
import { useEffect } from 'react';
import { useTenant } from '@/context/TenantContext';
import { useDeskTheme } from '@/components/pos/desk/kit';
import { lifted, pageColor, readable } from '@/lib/studio-page';

/** The business's accent: their booking-page colour (same one the front desk uses). */
export function accentOf(t: any): string | null {
  const c = pageColor(t);
  return typeof c === 'string' && /^#?[0-9a-f]{6}$/i.test(c.trim()) ? (c.trim().startsWith('#') ? c.trim() : `#${c.trim()}`) : null;
}
function hexToRgb(h: string) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
/** "h s% l%" for the CSS variables: the color, darkened if needed so white text on it passes 4.5:1 (or, on the black
 *  look, lightened so dark text on it does). */
export function accentHsl(hex: string | null, dark = false): string | null {
  if (!hex) return null; const rgb = hexToRgb(dark ? lifted(hex) : readable(hex));
  const [r, g, b] = rgb.map((v) => v / 255); const max = Math.max(r, g, b), min = Math.min(r, g, b); const l = (max + min) / 2;
  let h = 0, s = 0; if (max !== min) { const d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export function StudioTheme() {
  const { selectedTenant } = useTenant() as any;
  const { resolved } = useDeskTheme();   // white or true black, this device's choice (lib/app-theme)
  // On the true-black look the color is lightened and its text is dark, like the app's own colors there.
  const accent = accentOf(selectedTenant);
  const hsl = accentHsl(accent, resolved === 'dark');
  const fg = resolved === 'dark' ? '0 0% 0%' : '0 0% 100%';
  useEffect(() => {
    const root = document.documentElement; const dark = resolved === 'dark';
    root.classList.toggle('dark', dark); root.style.colorScheme = dark ? 'dark' : 'light';
    return () => { root.classList.remove('dark'); root.style.colorScheme = ''; };
  }, [resolved]);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('studio');
    const vars = ['--primary', '--ring', '--sidebar-primary', '--sidebar-ring'];
    if (hsl) { vars.forEach((v) => root.style.setProperty(v, hsl)); root.style.setProperty('--primary-foreground', fg); root.style.setProperty('--sidebar-primary-foreground', fg); }
    else { vars.forEach((v) => root.style.removeProperty(v)); root.style.removeProperty('--primary-foreground'); root.style.removeProperty('--sidebar-primary-foreground'); }
    return () => { root.classList.remove('studio'); [...vars, '--primary-foreground', '--sidebar-primary-foreground'].forEach((v) => root.style.removeProperty(v)); };
  }, [hsl, fg]);
  return null;
}
