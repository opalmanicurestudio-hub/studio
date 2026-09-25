// src/components/auth/AuthBackdrop.tsx
//
// The same world as the landing page — warm paper, soft moving light — for
// sign-in, sign-up and Your ClarityFlow, so the experience doesn't drop out
// the moment someone decides to join. Pure CSS; still for "reduce motion".

export function AuthBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden bg-[#f7f5f2]">
      <style>{`.cf-o{animation:cf-o 18s ease-in-out infinite alternate}.cf-o2{animation-duration:22s;animation-delay:-6s}.cf-o3{animation-duration:26s;animation-delay:-12s}@keyframes cf-o{to{transform:translate3d(40px,-30px,0) scale(1.08)}}@media (prefers-reduced-motion: reduce){.cf-o{animation:none}}`}</style>
      <div className="cf-o absolute -left-32 -top-32 h-[520px] w-[520px] rounded-full bg-gradient-to-br from-amber-200/60 via-rose-200/50 to-transparent blur-3xl" />
      <div className="cf-o cf-o2 absolute -right-40 top-1/3 h-[560px] w-[560px] rounded-full bg-gradient-to-bl from-violet-200/50 via-sky-200/40 to-transparent blur-3xl" />
      <div className="cf-o cf-o3 absolute -bottom-40 left-1/4 h-[480px] w-[480px] rounded-full bg-gradient-to-tr from-emerald-200/40 via-amber-100/40 to-transparent blur-3xl" />
    </div>
  );
}

export const Wordmark = ({ className = '' }: { className?: string }) => (
  <span className={`font-light tracking-tight ${className}`}>Clarity<span className="font-semibold">Flow</span></span>
);
