'use client';

import React, { useState, useMemo } from 'react';
import { AppHeader } from '@/components/shared/AppHeader';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { 
    Star, 
    MessageSquare, 
    Users, 
    Quote, 
    ShieldCheck, 
    Eye, 
    EyeOff, 
    Loader, 
    Sparkles,
    Activity,
    User,
    Scissors
} from 'lucide-react';
import { useInventory } from '@/context/InventoryContext';
import { useFirebase, updateDocumentNonBlocking } from '@/firebase';
import { useTenant } from '@/context/TenantContext';
import { doc } from 'firebase/firestore';
import { type Review } from '@/lib/data';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import Link from 'next/link';

const KpiCard = ({ title, value, icon: Icon, description, colorClass }: { title: string, value: string, icon: any, description: string, colorClass?: string }) => (
    <Card className="border-2 shadow-sm min-w-0 text-left bg-white/50 backdrop-blur-sm">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60">
                {title}
            </CardTitle>
            <Icon className={cn("h-4 w-4 opacity-40", colorClass || "text-slate-900")} />
        </CardHeader>
        <CardContent>
            <div className={cn("text-2xl md:text-3xl font-black tracking-tighter font-mono", colorClass || "text-slate-900")}>
                {value}
            </div>
            <p className="text-[9px] font-bold text-muted-foreground uppercase mt-1 opacity-40">{description}</p>
        </CardContent>
    </Card>
);

const ReviewCard = ({ review, onTogglePublic }: { review: Review, onTogglePublic: (id: string, isPublic: boolean) => void }) => {
  const isPublic = review.isPublic;

  return (
    <Card className={cn(
        "transition-all duration-300 border-2 rounded-[2rem] overflow-hidden group h-full flex flex-col",
        isPublic ? "border-primary/20 bg-white shadow-md" : "border-border/50 bg-muted/5 opacity-80"
    )}>
      <CardContent className="p-6 md:p-8 space-y-6 flex-1 text-left">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <Avatar className="w-12 h-12 border-2 border-background shadow-md rounded-2xl shrink-0">
                <AvatarImage src={review.clientAvatarUrl} alt={review.clientName} className="object-cover" />
                <AvatarFallback className="font-black bg-primary/10 text-primary">{(review.clientName || 'C').charAt(0)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
                <p className="font-black uppercase tracking-tight text-sm text-slate-900 truncate">{review.clientName}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                    <div className="flex">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <Star key={i} className={cn("w-2.5 h-2.5", i < review.rating ? "text-amber-400 fill-current" : "text-muted opacity-30")} />
                        ))}
                    </div>
                    <span className="text-[9px] font-black font-mono text-amber-600">{review.rating.toFixed(1)}</span>
                </div>
            </div>
          </div>
          <Badge variant="outline" className="h-5 px-2 font-black text-[8px] uppercase tracking-widest border-2 shrink-0">
            {formatDistanceToNow(parseISO(review.createdAt), { addSuffix: true })}
          </Badge>
        </div>

        <div className="p-5 rounded-2xl bg-muted/20 border-2 border-transparent group-hover:border-primary/5 transition-all relative">
            <Quote className="absolute -top-3 -left-2 w-8 h-8 text-primary opacity-10" />
            <p className="text-sm font-medium text-slate-700 leading-relaxed italic relative z-10">
                "{review.text}"
            </p>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="p-3 rounded-xl bg-background border shadow-inner">
                <p className="text-[8px] font-black uppercase text-muted-foreground opacity-40 mb-1 flex items-center gap-1">
                    <Scissors className="w-2.5 h-2.5" /> Treatment
                </p>
                <p className="font-black text-[10px] uppercase tracking-tight text-slate-700 truncate">{review.serviceName}</p>
            </div>
            <div className="p-3 rounded-xl bg-background border shadow-inner">
                <p className="text-[8px] font-black uppercase text-muted-foreground opacity-40 mb-1 flex items-center gap-1">
                    <User className="w-2.5 h-2.5" /> Technician
                </p>
                <p className="font-black text-[10px] uppercase tracking-tight text-slate-700 truncate">Technician</p>
            </div>
        </div>
      </CardContent>

      <CardFooter className="p-4 bg-muted/5 border-t mt-auto">
        <div className="flex items-center justify-between w-full p-3 rounded-2xl bg-white border-2 border-border/50 shadow-sm">
            <div className="flex items-center gap-3">
                <div className={cn("p-2 rounded-xl", isPublic ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground opacity-40")}>
                    {isPublic ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </div>
                <div className="text-left">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-900">{isPublic ? 'Publicly Visible' : 'Internal Only'}</p>
                    <p className="text-[8px] font-bold text-muted-foreground uppercase opacity-60">{isPublic ? 'Shown on booking page' : 'Hidden from guests'}</p>
                </div>
            </div>
            <Switch
                id={`public-switch-${review.id}`}
                checked={isPublic}
                onCheckedChange={(checked) => onTogglePublic(review.id, checked)}
                className="data-[state=checked]:bg-primary"
            />
        </div>
      </CardFooter>
    </Card>
  );
};

const Badge = ({ children, className, variant }: any) => (
    <div className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2", className)}>
        {children}
    </div>
);

export default function ReviewsPage() {
  const { reviews, isLoading } = useInventory();
  const { firestore } = useFirebase();
  const { selectedTenant } = useTenant();

  const handleTogglePublic = (reviewId: string, isPublic: boolean) => {
    if (!firestore || !selectedTenant) return;
    const reviewRef = doc(firestore, `tenants/${selectedTenant.id}/reviews`, reviewId);
    updateDocumentNonBlocking(reviewRef, { isPublic });
  };

  const { avgRating, publicReviews, totalReviews } = useMemo(() => {
    if (!reviews || reviews.length === 0) {
      return { avgRating: 0, publicReviews: 0, totalReviews: 0 };
    }
    const total = reviews.reduce((acc, r) => acc + r.rating, 0);
    return {
      avgRating: total / reviews.length,
      publicReviews: reviews.filter(r => r.isPublic).length,
      totalReviews: reviews.length,
    };
  }, [reviews]);

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50/50 relative overflow-x-hidden">
      {/* Visual Atmosphere */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/5 blur-[120px] rounded-full animate-pulse" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-500/5 blur-[120px] rounded-full animate-pulse" />
      </div>

      <AppHeader title="Reputation Suite" />
      <main className="relative z-10 flex-1 p-4 md:p-10 w-full max-w-7xl mx-auto min-w-0 space-y-8 md:space-y-10">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-1 text-left">
            <h1 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-slate-900 leading-none">Feedback Ledger</h1>
            <p className="text-sm text-muted-foreground font-black uppercase tracking-[0.2em] opacity-60">
              Reputation yield & visibility control
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <KpiCard title="Alpha Rating" value={avgRating.toFixed(2)} icon={Star} description="Avg across all feedback" colorClass="text-amber-500" />
            <KpiCard title="Engagement Volume" value={totalReviews.toString()} icon={MessageSquare} description="Total client stories logged" />
            <KpiCard title="Public Reach" value={publicReviews.toString()} icon={Users} description="Visible on studio portal" colorClass="text-primary" />
        </div>

        <Card className="border-2 shadow-sm rounded-[2.5rem] overflow-hidden bg-white/80 backdrop-blur-xl">
          <CardHeader className="bg-muted/5 border-b p-6 md:p-8">
            <div className="flex items-center gap-3 mb-1">
                <Activity className="w-5 h-5 text-primary" />
                <CardTitle className="text-base md:text-lg font-black uppercase tracking-tight">Audit Trail</CardTitle>
            </div>
            <CardDescription className="text-[10px] font-bold uppercase tracking-widest opacity-60">Complete history of studio guest sentiment.</CardDescription>
          </CardHeader>
          <CardContent className="p-6 md:p-8">
            {isLoading ? (
                <div className="flex flex-col items-center justify-center p-24 gap-4">
                    <Loader className="animate-spin h-8 w-8 text-primary" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-primary opacity-60">Synchronizing Dossiers...</p>
                </div>
            ) : reviews && reviews.length > 0 ? (
                <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                    {reviews.map(review => (
                        <ReviewCard key={review.id} review={review} onTogglePublic={handleTogglePublic} />
                    ))}
                </div>
            ) : (
                <div className="text-center py-24 md:py-32 px-6 border-4 border-dashed rounded-[3rem] opacity-30 flex flex-col items-center gap-6">
                    <div className="p-6 bg-muted rounded-[2rem] shadow-inner"><Quote className="h-16 w-16 text-muted-foreground" /></div>
                    <div className="space-y-2 text-center">
                        <h3 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Archives Empty</h3>
                        <p className="text-sm font-bold uppercase tracking-tight max-w-sm mx-auto">
                            Guest feedback is currently at zero. New reviews will automatically populate this ledger upon guest submission.
                        </p>
                    </div>
                </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-4 border-primary/20 bg-primary/5 rounded-[2.5rem] shadow-2xl shadow-primary/5 overflow-hidden relative group">
            <div className="absolute top-0 right-0 p-8 opacity-5 transition-opacity group-hover:opacity-10">
                <ShieldCheck className="w-32 h-32 text-primary" />
            </div>
            <CardHeader className="p-8 pb-4 text-left">
                <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-primary rounded-xl">
                        <Sparkles className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-[0.25em] text-primary">Master Control</span>
                </div>
                <CardTitle className="text-2xl md:text-3xl font-black uppercase tracking-tighter">Publicity Strategy</CardTitle>
                <CardDescription className="text-sm font-medium text-slate-600 max-w-lg">Visible reviews directly influence conversion on your Booking Page. Audit periodically to ensure your digital portfolio is optimal.</CardDescription>
            </CardHeader>
            <CardFooter className="p-8 pt-4">
                <Button variant="outline" asChild className="h-12 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest bg-white">
                    <Link href="/settings?tab=builder">Configure Booking Page</Link>
                </Button>
            </CardFooter>
        </Card>
      </main>
    </div>
  );
}
