// src/components/screens/screen-icons.ts — The icon for each screen (lib/screens), in the menu and on the Screens page.
import { Boxes, Car, ChefHat, CircleCheck, Clock, Coffee, ConciergeBell, DoorOpen, Fingerprint, Hourglass, Layers, ListOrdered, Mic, Monitor, Shield, SprayCan, Tablet, TabletSmartphone, Tv } from 'lucide-react';
import type { ScreenId } from '@/lib/screens';

export const SCREEN_ICONS: Record<ScreenId, any> = {
  lane: Car, 'menu-board': Tv, speaker: Mic, 'order-board': ListOrdered, window: Monitor, kiosk: TabletSmartphone, ready: CircleCheck,
  kds: ChefHat, dish: SprayCan, barback: Boxes, 'host-stand': ConciergeBell, floor: Layers,
  'walk-in': Fingerprint, 'check-in': DoorOpen, lobby: Hourglass, 'client-screen': Tablet, concierge: Coffee,
  timeclock: Clock, 'staff-portal': Shield,
};
