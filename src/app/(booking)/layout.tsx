
export default function BookingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen w-full flex-col items-center bg-muted/40 overflow-x-hidden">
      <div className="w-full max-w-4xl p-4 md:p-8">
        {children}
      </div>
    </div>
  );
}
