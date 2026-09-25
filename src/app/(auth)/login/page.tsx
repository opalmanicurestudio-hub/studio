'use client';
// src/app/(auth)/login/page.tsx
//
// SIGN IN — the same calm world as the landing page. Logic unchanged:
// email + password through Firebase Auth → /dashboard; "Forgot password?"
// sends Firebase's reset email, right here on the page.

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getAuth, signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { Eye, EyeOff, Loader } from 'lucide-react';
import { Wordmark } from '@/components/auth/AuthBackdrop';

const loginSchema = z.object({
  email: z.string().email('That doesn’t look like an email address.'),
  password: z.string().min(6, 'Passwords are at least 6 characters.'),
});
type LoginFormData = z.infer<typeof loginSchema>;

const field = 'h-12 w-full rounded-2xl border border-white/80 bg-white/70 px-4 text-[15px] outline-none transition focus:bg-white focus:ring-2 focus:ring-stone-300';

export default function LoginPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [show, setShow] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<LoginFormData>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (data: LoginFormData) => {
    setBusy(true); setErr('');
    try {
      await signInWithEmailAndPassword(getAuth(), data.email, data.password);
      router.push('/dashboard');
    } catch {
      setErr('That email and password don’t match. Try again, or reset your password.');
    } finally { setBusy(false); }
  };

  const reset = async () => {
    if (!resetEmail.includes('@')) { setErr('Enter the email you sign in with.'); return; }
    setResetBusy(true); setErr('');
    try { await sendPasswordResetEmail(getAuth(), resetEmail); setResetSent(true); }
    catch { setErr('We couldn’t send a reset email to that address.'); }
    finally { setResetBusy(false); }
  };

  return (
    <div className="flex min-h-dvh flex-col px-5 py-6">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between">
        <Link href="/" className="text-lg"><Wordmark /></Link>
        <Link href="/demo" className="text-sm text-stone-600">Try the demo</Link>
      </header>

      <main className="flex flex-1 items-center justify-center py-10">
        <div className="w-full max-w-sm cf-enter">
          <style>{`.cf-enter{animation:cf-enter .9s cubic-bezier(.22,1,.36,1) both}@keyframes cf-enter{from{opacity:0;transform:translateY(16px);filter:blur(6px)}to{opacity:1;transform:none;filter:none}}@media (prefers-reduced-motion: reduce){.cf-enter{animation:none}}`}</style>
          <h1 className="text-center text-4xl font-light tracking-tight">Welcome <span className="font-semibold">back.</span></h1>
          <p className="mt-2 text-center text-stone-600">Your business, right where you left it.</p>

          {!resetOpen ? (
            <form onSubmit={handleSubmit(onSubmit)} className="glass mt-8 space-y-3 rounded-[2rem] p-5 sm:p-6" noValidate>
              <div>
                <input {...register('email')} type="email" autoComplete="email" placeholder="Email" className={field} aria-invalid={!!errors.email} />
                {errors.email && <p className="mt-1 px-1 text-[12px] text-red-700">{errors.email.message}</p>}
              </div>
              <div>
                <div className="relative">
                  <input {...register('password')} type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="Password" className={field + ' pr-12'} aria-invalid={!!errors.password} />
                  <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-stone-400">{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                </div>
                {errors.password && <p className="mt-1 px-1 text-[12px] text-red-700">{errors.password.message}</p>}
              </div>
              {err && <p className="rounded-2xl bg-red-50 px-3 py-2 text-[13px] text-red-800">{err}</p>}
              <button type="submit" disabled={busy} className="flex h-12 w-full items-center justify-center rounded-full bg-stone-900 text-sm font-medium text-white shadow-[0_12px_30px_-12px_rgba(28,25,23,0.6)] disabled:opacity-60">
                {busy ? <Loader className="h-4 w-4 animate-spin" /> : 'Sign in'}
              </button>
              <button type="button" onClick={() => { setResetOpen(true); setErr(''); }} className="w-full text-center text-[13px] text-stone-500">Forgot password?</button>
            </form>
          ) : (
            <div className="glass mt-8 space-y-3 rounded-[2rem] p-5 sm:p-6">
              {resetSent ? (
                <div className="py-4 text-center">
                  <p className="text-3xl">✉️</p>
                  <p className="mt-2 font-semibold">Check your email</p>
                  <p className="mt-1 text-sm text-stone-600">We sent a reset link to {resetEmail}.</p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-stone-600">Enter your email and we’ll send you a link to set a new password.</p>
                  <input value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} type="email" autoComplete="email" placeholder="Email" className={field} />
                  {err && <p className="rounded-2xl bg-red-50 px-3 py-2 text-[13px] text-red-800">{err}</p>}
                  <button type="button" onClick={reset} disabled={resetBusy} className="flex h-12 w-full items-center justify-center rounded-full bg-stone-900 text-sm font-medium text-white disabled:opacity-60">{resetBusy ? <Loader className="h-4 w-4 animate-spin" /> : 'Send reset link'}</button>
                </>
              )}
              <button type="button" onClick={() => { setResetOpen(false); setResetSent(false); setErr(''); }} className="w-full text-center text-[13px] text-stone-500">Back to sign in</button>
            </div>
          )}

          <p className="mt-6 text-center text-sm text-stone-600">New here? <Link href="/signup" className="font-medium text-stone-900 underline-offset-2 hover:underline">Set up your business</Link></p>
        </div>
      </main>
    </div>
  );
}
