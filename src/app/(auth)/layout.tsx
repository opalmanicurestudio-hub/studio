export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background text-foreground flex flex-col items-center justify-center p-4 overflow-x-hidden relative font-body">
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-15%] left-[-10%] w-[55%] h-[45%] bg-foreground/[0.05] blur-[130px] rounded-full" />
        <div className="absolute bottom-[-15%] right-[-10%] w-[50%] h-[45%] bg-foreground/[0.04] blur-[130px] rounded-full" />
      </div>

      <div className="relative z-10 w-full flex justify-center">
        {children}
      </div>
    </div>
  );
}
