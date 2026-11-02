// /studio/page-builder — the old page builder. Every business's booking page is now the one design, made theirs in
// Settings › Booking page (color, mood, cover, headline, sections and their words and photos), so an old bookmark
// lands there.
import { redirect } from 'next/navigation';

export default function OldPageBuilder() {
  redirect('/settings/booking-page');
}
