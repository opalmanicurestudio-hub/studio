
import { Button, buttonVariants } from '@/components/ui/button';
import { ClarityFlowLogo } from '@/components/shared/AppSidebar';
import { Check, LogIn } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { cn } from '@/lib/utils';

const features = [
    'Smart Walk-in & Appointment Scheduling',
    'True Minimum Hourly Rate (TMHR) Calculation',
    'Client Management & Custom Formulas',
    'Inventory & Product Costing',
    'Staff Performance & Payroll',
    'AI-Powered Business Insights'
]

export default function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen bg-background">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center justify-between">
            <div className="flex items-center gap-3">
                <ClarityFlowLogo />
                <h1 className="text-lg font-bold">ClarityFlow</h1>
            </div>
            <div className="flex items-center gap-2">
                <Link href="/subscriptions" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
                    Pricing
                </Link>
                <Link href="/login" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), "gap-2")}>
                    <LogIn />
                    Login
                </Link>
            </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="container py-20 text-center flex flex-col items-center">
            <h2 className="text-4xl md:text-6xl font-extrabold tracking-tight">
                Find Your Flow.
            </h2>
            <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
                ClarityFlow is the all-in-one business management app designed exclusively for solo service professionals. Stop guessing, start growing.
            </p>
             <div className="mt-8 flex gap-4">
                <Link href="/signup" className={buttonVariants({ size: 'lg' })}>
                    Get Started
                </Link>
                <Link href="/login" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
                    Sign In
                </Link>
            </div>
        </section>

        <section className="container pb-20">
             <div className="grid md:grid-cols-2 gap-8 items-center">
                <div className="relative aspect-video rounded-xl overflow-hidden shadow-2xl">
                     <Image 
                        src="https://images.unsplash.com/photo-1600965962235-554865159157?q=80&w=1287&auto=format&fit=crop" 
                        alt="Salon Owner using a tablet"
                        fill
                        className="object-cover"
                        data-ai-hint="salon management"
                    />
                </div>
                <div className="space-y-4">
                    <h3 className="text-3xl font-bold">Everything you need. Nothing you don't.</h3>
                    <ul className="space-y-3">
                        {features.map((feature, i) => (
                             <li key={i} className="flex items-center gap-3">
                                <div className="p-1.5 bg-primary/10 rounded-full">
                                    <Check className="w-4 h-4 text-primary" />
                                </div>
                                <span className="text-muted-foreground">{feature}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="container py-6 text-center text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} ClarityFlow. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
