// src/lib/event-types.ts
// ─────────────────────────────────────────────────────────────────────────────
// TypeScript types for the Event Dining System
// ─────────────────────────────────────────────────────────────────────────────

export interface EventMenuItem {
  id: string;
  eventId: string;
  tenantId: string;
  name: string;
  description?: string;
  category: 'starter' | 'main' | 'dessert' | 'beverage' | 'other';
  courseNumber: number;           // 1=starter, 2=main, 3=dessert
  isVegan: boolean;
  isGlutenFree: boolean;
  isDairyFree: boolean;
  isHalal: boolean;
  isKosher: boolean;
  imageUrl?: string;
}

export interface EventGuest {
  id: string;
  eventId: string;
  tenantId: string;
  name: string;
  email?: string;
  phone?: string;
  seatNumber?: string;
  tableNumber?: string;
  mealChoiceId?: string;         // points to EventMenuItem.id
  mealChoiceName?: string;       // denormalized for fast reads
  courseSelections?: Record<number, string>; // courseNumber → menuItemId (multi-course)
  allergies: string[];           // free-form: ['nuts', 'shellfish']
  dietaryRestrictions: string[]; // ['vegan', 'gluten-free', 'kosher']
  notes?: string;
  submittedAt?: string;
  checkInToken: string;          // UUID — used in seat QR code
  checkedIn: boolean;
  checkedInAt?: string;
  clientId?: string;             // if matched to existing client
}

export interface FloorRequest {
  id: string;
  eventId: string;
  tenantId: string;
  guestId?: string;
  guestName?: string;
  seatNumber?: string;
  tableNumber?: string;
  type: 'napkins' | 'water' | 'condiments' | 'utensils' | 'accessibility' | 'other';
  requestText?: string;
  status: 'new' | 'acknowledged' | 'done';
  createdAt: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  // Never touches KDS — this is floor staff only
}

export interface CourseFire {
  id: string;
  eventId: string;
  tenantId: string;
  courseNumber: number;
  courseName: string;            // e.g. "Course 1 — Starters"
  firedAt: string;
  firedBy: string;               // staffId
  guestCount: number;
  status: 'fired' | 'completed';
  // Each fire generates KDS tickets for all guests with that courseNumber selection
}

// Floor request types available during event mode on kiosk
export const FLOOR_REQUEST_TYPES: { type: FloorRequest['type']; label: string; icon: string }[] = [
  { type: 'water',        label: 'Water Refill',      icon: '💧' },
  { type: 'napkins',      label: 'Extra Napkins',      icon: '🗒' },
  { type: 'condiments',   label: 'Condiments',         icon: '🧴' },
  { type: 'utensils',     label: 'Extra Utensils',     icon: '🍴' },
  { type: 'accessibility',label: 'Assistance Needed',  icon: '♿' },
  { type: 'other',        label: 'Other Request',      icon: '💬' },
];

export const ALLERGY_OPTIONS = [
  'Nuts', 'Peanuts', 'Tree Nuts', 'Shellfish', 'Fish', 'Dairy', 'Eggs',
  'Gluten / Wheat', 'Soy', 'Sesame', 'Sulfites',
];

export const DIETARY_OPTIONS = [
  'Vegan', 'Vegetarian', 'Gluten-Free', 'Dairy-Free', 'Halal', 'Kosher',
  'Low Sodium', 'Diabetic-Friendly',
];