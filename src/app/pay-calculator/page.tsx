import type { Metadata } from 'next';
import PayCalculator from '@/components/paycalc/PayCalculator';

export const metadata: Metadata = {
  title: 'Pay calculator: what is your work really paying you?',
  description: 'Your real pay per hour, counting every hour, your own costs, benefits and the commute, next to government pay data. Free, no sign-up, and your numbers stay on your device.',
};

export default function Page() {
  return <PayCalculator />;
}
