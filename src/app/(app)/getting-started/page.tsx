// src/app/(app)/getting-started/page.tsx — Getting started is now Settings › Set up your business (settings/setup), with
// the same steps and more, each opening the real page. Old links land there.
import { redirect } from 'next/navigation';

export default function GettingStartedPage() {
  redirect('/settings/setup');
}
