import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Safely extracts a numeric value from a potential Firestore FieldValue (Sentinel) object.
 * Returns 0 if the value is not a valid number or is a Firestore metadata object.
 */
export function safeNumber(val: any): number {
  if (val === null || val === undefined) return 0;
  
  // Explicitly handle numbers
  if (typeof val === 'number') return val;
  
  // Attempt to cast to number. 
  // Firestore Sentinel objects (increment) result in NaN when passed to Number()
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

/**
 * Converts a Hex color to HSL components string "H S% L%" 
 * for use with Tailwind's hsl(var(--primary)) configuration.
 */
export function hexToHSLComponents(hex: string): string {
    if (!hex || !hex.startsWith('#')) return '';
    
    let r = 0, g = 0, b = 0;
    if (hex.length === 4) {
        r = parseInt(hex[1] + hex[1], 16);
        g = parseInt(hex[2] + hex[2], 16);
        b = parseInt(hex[3] + hex[3], 16);
    } else if (hex.length === 7) {
        r = parseInt(hex.substring(1, 3), 16);
        g = parseInt(hex.substring(3, 5), 16);
        b = parseInt(hex.substring(5, 7), 16);
    }
    r /= 255; g /= 255; b /= 255;
    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; } else {
        let d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}
