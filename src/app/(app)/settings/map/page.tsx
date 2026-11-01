// src/app/(app)/settings/map/page.tsx — Quick settings is now Settings itself (eleven groups, one list, search).
// Old links land there.
import { redirect } from 'next/navigation';

export default function SettingsMapPage() {
  redirect('/settings');
}
