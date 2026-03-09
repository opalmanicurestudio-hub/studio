'use client';

import { Button, buttonVariants } from '@/components/ui/button';
import { ClarityFlowLogo } from '@/components/shared/AppSidebar';
import { 
    Check, 
    LogIn, 
    Sparkles, 
    TrendingUp, 
    ShieldCheck, 
    Users, 
    Zap, 
    Clock, 
    DollarSign, 
    Award,
    ArrowRight,
    MousePointer2,
    Calculator,
    Smartphone,
    LayoutDashboard,
    Users2
} from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

const features = [
    {
        title: "Yield Architecture",
        desc: "Automated TMHR calculation ensures every session—for you or your team—is priced for maximum studio profit.",
        icon: Calculator,
        color: "text-primary"
    },
    {
        title: "Command Hub",
        desc: "Manage booth renters or employees with automated turn-orders, staff performance tracking, and unified payroll logic.",
        icon: Users2,
        color: "text-indigo-500"
    },
    {
        title: "Terminal Flow",
        desc: "A high-fidelity POS terminal that handles group checkouts, retail sales, and team-wide tip allocations with one tap.",
        icon: Zap,
        color: "text-amber-500"
    },
    {
        title: "AI CFO Intel",
        desc: "Strategic daily debriefs and financial forecasting powered by your own real-time studio and team performance data.",
        icon: Sparkles,
        color: "text-primary"
    }
]

const SectionHeader = ({ badge, title, subtitle }: { badge: string, title: string, subtitle: string }) => (
    <div className="space-y-4 mb-16 text-center lg:text-left">
        <div className="inline-flex items-center gap-2 bg-primary/5 px-4 py-1.5 rounded-full border border-primary/10">
            <span className="text-[10px] font-black uppercase tracking-[0.25em] text-primary">{badge}</span>
        </div>
        <h2 className="text-4xl md:text-6xl font-black uppercase tracking-tighter text-slate-900 leading-none">{title}</h2>
        <p className="text-slate-500 font-medium uppercase tracking-[0.2em] text-[10px] opacity-60">{subtitle}</p>
    </div>
);

export default function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen bg-background selection:bg-primary/20">
      {/* ATMOSPHERIC BACKGROUND */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/5 blur-[120px] rounded-full animate-pulse" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-500/5 blur-[120px] rounded-full animate-pulse" />
      </div>

      <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-xl px-4 md:px-8">
        <div className="container flex h-20 items-center justify-between mx-auto">
            <div className="flex items-center gap-4">
                <ClarityFlowLogo className="w-10 h-10" />
                <div className="flex flex-col">
                    <h1 className="text-2xl font-black uppercase tracking-tighter text-slate-900 leading-none">ClarityFlow</h1>
                    <p className="text-[8px] font-black uppercase tracking-[0.3em] text-primary mt-1 opacity-60">Studio OS</p>
                </div>
            </div>
            <div className="flex items-center gap-4">
                <Link href="/login" className="hidden sm:flex text-[10px] font-black uppercase tracking-widest text-slate-600 hover:text-primary transition-colors">
                    Access Portal
                </Link>
                <Link href="/signup" className={cn(buttonVariants({ size: 'sm' }), "h-10 px-6 rounded-xl shadow-xl shadow-primary/20 font-black uppercase tracking-widest text-[10px]")}>
                    Get Started
                </Link>
            </div>
        </div>
      </header>

      <main className="flex-1 relative z-10">
        {/* HERO SECTION */}
        <section className="container py-20 md:py-32 lg:py-48 mx-auto px-6">
            <div className="flex flex-col items-center text-center max-w-5xl mx-auto space-y-10">
                <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8 }}
                    className="space-y-6"
                >
                    <div className="inline-flex items-center gap-3 bg-white/50 backdrop-blur-md px-6 py-2 rounded-full border-2 border-primary/10 shadow-sm mb-4">
                        <Sparkles className="w-4 h-4 text-primary" />
                        <span className="text-[10px] font-black uppercase tracking-[0.25em] text-primary">High Fidelity Studio Management</span>
                    </div>
                    <h2 className="text-5xl md:text-[7rem] font-black tracking-tighter text-slate-900 leading-[0.85] uppercase">
                        Stop Guessing.<br/>
                        <span className="text-primary italic font-serif lowercase tracking-normal">Start</span> Growing.
                    </h2>
                    <p className="mt-8 max-w-2xl mx-auto text-lg md:text-xl text-slate-600 font-medium leading-relaxed">
                        The all-in-one "Studio Operating System" built for solo masters and high-performance teams. Protect your time, secure your yield, and find your flow.
                    </p>
                </motion.div>

                <motion.div 
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.4, duration: 0.8 }}
                    className="flex flex-col sm:flex-row gap-4 w-full justify-center"
                >
                    <Link href="/signup" className={cn(buttonVariants({ size: 'lg' }), "h-16 px-12 rounded-[2rem] text-lg font-black uppercase shadow-2xl shadow-primary/30 group tracking-tight")}>
                        Initialize Studio <ArrowRight className="ml-3 w-6 h-6 transition-transform group-hover:translate-x-1" />
                    </Link>
                    <Link href="/login" className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), "h-16 px-12 rounded-[2rem] text-lg font-black uppercase border-2 bg-white/50 backdrop-blur-sm shadow-sm tracking-tight")}>
                        Access Terminal
                    </Link>
                </motion.div>
            </div>
        </section>

        {/* STRATEGIC MODULES */}
        <section className="container py-32 mx-auto px-6">
            <div className="grid lg:grid-cols-2 gap-24 items-center">
                <div className="relative">
                    <div className="absolute -top-10 -left-10 w-32 h-32 bg-primary/10 rounded-full blur-3xl" />
                    <div className="relative aspect-[4/5] rounded-[3rem] overflow-hidden border-4 border-white shadow-3xl">
                        <Image 
                            src="https://images.unsplash.com/photo-1600965962235-554865159157?q=80&w=1287&auto=format&fit=crop" 
                            alt="Professional managing studio"
                            fill
                            className="object-cover grayscale contrast-125 brightness-90"
                            data-ai-hint="professional salon"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-transparent to-transparent" />
                        <div className="absolute bottom-10 left-10 right-10 p-8 bg-white/10 backdrop-blur-xl border border-white/20 rounded-[2rem] shadow-2xl">
                            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary mb-2">Studio Insight</p>
                            <p className="text-white text-xl font-black uppercase tracking-tight leading-tight">"From solo master to studio lead—ClarityFlow scales the foundation of our entire team."</p>
                        </div>
                    </div>
                </div>

                <div className="space-y-12">
                    <SectionHeader 
                        badge="Strategic Capabilities" 
                        title="Architecture for Profit" 
                        subtitle="Standardize excellence across your team." 
                    />
                    <div className="grid gap-8">
                        {features.map((feature, i) => (
                             <motion.div 
                                key={i}
                                initial={{ opacity: 0, x: 20 }}
                                whileInView={{ opacity: 1, x: 0 }}
                                transition={{ delay: i * 0.1 }}
                                viewport={{ once: true }}
                                className="group flex items-start gap-6 p-8 rounded-[2.5rem] border-2 border-border/50 bg-white hover:border-primary/20 transition-all shadow-sm hover:shadow-xl"
                             >
                                <div className="p-4 rounded-2xl bg-muted/20 group-hover:bg-primary transition-all duration-500 shadow-inner">
                                    <feature.icon className={cn("w-6 h-6 group-hover:text-white transition-colors", feature.color)} />
                                </div>
                                <div className="space-y-2 text-left">
                                    <h3 className="text-lg font-black uppercase tracking-tight text-slate-900">{feature.title}</h3>
                                    <p className="text-sm text-slate-500 leading-relaxed font-medium">{feature.desc}</p>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                </div>
            </div>
        </section>

        {/* PRICING SECTION */}
        <section className="container py-32 mx-auto px-6">
            <div className="max-w-4xl mx-auto">
                <SectionHeader 
                    badge="Investment" 
                    title="Simple. Transparent. Scalable." 
                    subtitle="One pass for total studio orchestration." 
                />
                
                <Card className="border-4 border-primary rounded-[3rem] shadow-3xl overflow-hidden bg-white relative">
                    <div className="absolute top-0 right-0 p-12 opacity-5 pointer-events-none">
                        <Award className="w-64 h-64 text-primary" />
                    </div>
                    <CardHeader className="p-12 text-center border-b bg-muted/5">
                        <div className="inline-flex items-center gap-2 bg-primary text-white px-4 py-1.5 rounded-full font-black text-[10px] uppercase tracking-widest shadow-lg mb-6">
                            <ShieldCheck className="w-3.5 h-3.5" /> Pro Access
                        </div>
                        <CardTitle className="text-5xl font-black tracking-tighter uppercase leading-none">Studio Pass Pro</CardTitle>
                        <div className="flex items-baseline justify-center gap-2 pt-8">
                            <span className="text-7xl font-black tracking-tighter text-primary font-mono">$49</span>
                            <span className="text-muted-foreground font-black uppercase tracking-widest text-xs">/ per month</span>
                        </div>
                    </CardHeader>
                    <CardContent className="p-12 grid md:grid-cols-2 gap-12 text-left">
                        <div className="space-y-6">
                            <p className="text-[10px] font-black uppercase tracking-widest text-primary">Master Orchestration</p>
                            <ul className="space-y-4">
                                {[
                                    'Unlimited Client Dossiers',
                                    'Multi-User Team Sync',
                                    'Automated Turn-Order Logic',
                                    'Encrypted POS Terminal',
                                    'Public Booking Microsite',
                                    'Staff Performance Analytics'
                                ].map((item, i) => (
                                    <li key={i} className="flex items-center gap-3">
                                        <div className="p-1 bg-green-500/10 rounded-full text-green-600 shrink-0">
                                            <Check className="w-3.5 h-3.5" />
                                        </div>
                                        <span className="text-xs font-black uppercase tracking-tight text-slate-700">{item}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="space-y-6">
                            <p className="text-[10px] font-black uppercase tracking-widest text-primary">Intelligence & Yield</p>
                            <ul className="space-y-4">
                                {[
                                    'Daily Yield Debriefs',
                                    'Team Payout Computation',
                                    'Automated Loyalty Engine',
                                    'Landed Cost Manifest',
                                    'Security Audit Logs',
                                    'Unlimited SMS Notifications'
                                ].map((item, i) => (
                                    <li key={i} className="flex items-center gap-3">
                                        <div className="p-1 bg-primary/10 rounded-full text-primary shrink-0">
                                            <Sparkles className="w-3.5 h-3.5" />
                                        </div>
                                        <span className="text-xs font-black uppercase tracking-tight text-slate-700">{item}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </CardContent>
                    <CardFooter className="p-12 pt-0">
                        <Link href="/signup" className={cn(buttonVariants({ size: 'lg' }), "w-full h-20 rounded-[2rem] text-xl font-black uppercase shadow-2xl shadow-primary/30 tracking-widest")}>
                            Secure Your Studio Pass
                        </Link>
                    </CardFooter>
                </Card>
            </div>
        </section>

        {/* FINAL CTA */}
        <section className="container py-32 md:py-48 mx-auto px-6 text-center">
            <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                className="max-w-3xl mx-auto space-y-12"
            >
                <h2 className="text-4xl md:text-7xl font-black uppercase tracking-tighter text-slate-900 leading-[0.9]">
                    Find Your <span className="text-primary italic font-serif lowercase tracking-normal">flow</span> today.
                </h2>
                <p className="text-xl text-slate-500 font-medium">Join the masters taking absolute control of their studio foundation.</p>
                <div className="pt-6">
                    <Link href="/signup" className={cn(buttonVariants({ size: 'lg' }), "h-20 px-16 rounded-[2.5rem] text-2xl font-black uppercase shadow-3xl shadow-primary/40 tracking-tighter group")}>
                        Get Started <ArrowRight className="ml-4 w-8 h-8 transition-transform group-hover:translate-x-2" />
                    </Link>
                </div>
            </motion.div>
        </section>
      </main>

      <footer className="border-t bg-white py-20 relative z-10 px-6">
        <div className="container mx-auto grid md:grid-cols-2 gap-12 items-center">
            <div className="flex items-center gap-4">
                <ClarityFlowLogo className="w-8 h-8 opacity-20" />
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground opacity-40">
                    &copy; {new Date().getFullYear()} ClarityFlow Studio OS &middot; Professional Ecosystem
                </p>
            </div>
            <div className="flex justify-start md:justify-end gap-8">
                <Link href="#" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors opacity-60">Terms of Use</Link>
                <Link href="#" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors opacity-60">Privacy Protocol</Link>
                <Link href="/login" className="text-[10px] font-black uppercase tracking-widest text-primary opacity-60">Support Center</Link>
            </div>
        </div>
      </footer>
    </div>
  );
}
