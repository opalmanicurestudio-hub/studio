// src/app/(auth)/layout.tsx — sign-in and sign-up live in the landing page's world.
import { AuthBackdrop } from '@/components/auth/AuthBackdrop';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-dvh overflow-x-hidden text-stone-900">
      <AuthBackdrop />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
