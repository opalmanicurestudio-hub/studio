
'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { motion } from 'framer-motion';
import { Star, Loader, Quote, Sparkles, CheckCircle2 } from 'lucide-react';
import { useFirebase, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { collection, query, where, doc } from 'firebase/firestore';
import { type Review, type Tenant } from '@/lib/data';
import { useParams } from 'next/navigation';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow, parseISO } from 'date-fns';

export const BookingReviews = () => {
  const { firestore } = useFirebase();
  const params = useParams();
  const tenantId = params.tenantId as string;

  const tenantDocRef = useMemoFirebase(() => doc(firestore, `tenants/${tenantId}`), [firestore, tenantId]);
  const { data: tenant } = useDoc<Tenant>(tenantDocRef);

  const reviewsQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId) return null;
    return query(
      collection(firestore, `tenants/${tenantId}/reviews`),
      where('isPublic', '==', true)
    );
  }, [firestore, tenantId]);

  const { data: reviews, isLoading } = useCollection<Review>(reviewsQuery);
  
  const sortedReviews = useMemo(() => {
    if (!reviews) return [];
    return [...reviews].sort((a, b) => {
        // Prioritize featured reviews
        if (a.isFeatured && !b.isFeatured) return -1;
        if (!a.isFeatured && b.isFeatured) return 1;
        // Then sort by date
        return parseISO(b.createdAt).getTime() - parseISO(a.createdAt).getTime();
    });
  }, [reviews]);

  if (isLoading || tenant?.bookingPageSettings?.showReviews === false) return null;
  if (!reviews || reviews.length === 0) return null;

  return (
    <section id="reviews" className="space-y-16 scroll-mt-24">
      <div className="space-y-4">
        <div className="inline-flex items-center gap-2 bg-primary/5 px-4 py-1.5 rounded-full border border-primary/10 mb-4">
            <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.25em] text-primary">Verified Sentiment</span>
        </div>
        <h2 className="text-3xl md:text-5xl font-black tracking-tighter uppercase text-slate-900 leading-none">
            {tenant?.bookingPageSettings?.reviewsSectionTitle || 'Voices'}
        </h2>
        <p className="text-muted-foreground font-medium uppercase tracking-[0.2em] text-[10px] opacity-60">
            Authenticated guest feedback from our studio ledger.
        </p>
      </div>

      <div className="grid gap-12">
        {sortedReviews.slice(0, 4).map((review, idx) => (
          <motion.div 
            key={review.id}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1, duration: 0.8 }}
            viewport={{ once: true, margin: "-100px" }}
            className="relative"
          >
            <div className="relative group flex flex-col md:flex-row gap-8 items-start">
                <div className="absolute -top-10 -left-6 pointer-events-none">
                    <Quote className="w-24 h-24 text-primary opacity-5 group-hover:opacity-10 transition-opacity" />
                </div>
                
                <div className="flex-1 space-y-6 relative z-10 text-left">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-1.5">
                            {Array.from({ length: 5 }).map((_, i) => (
                                <Star key={i} className={cn("w-3.5 h-3.5", i < review.rating ? "text-amber-400 fill-current" : "text-muted opacity-30")} />
                            ))}
                            <span className="text-[10px] font-black font-mono text-amber-600 ml-2">Verified Entry</span>
                        </div>
                        {review.isFeatured && (
                            <Badge className="bg-primary/10 text-primary border-none font-black text-[8px] h-5 uppercase tracking-widest px-2">
                                <Sparkles className="w-2.5 h-2.5 mr-1" /> Spotlight
                            </Badge>
                        )}
                    </div>

                    <p className="text-xl md:text-3xl font-black uppercase tracking-tighter text-slate-900 leading-[1.1]">
                        "{review.text}"
                    </p>

                    <div className="flex items-center gap-4 pt-2">
                        <Avatar className="w-12 h-12 border-4 border-white shadow-xl rounded-2xl">
                            <AvatarImage src={review.clientAvatarUrl} className="object-cover" />
                            <AvatarFallback className="font-black bg-primary/10 text-primary uppercase text-sm">
                                {(review.clientName || 'G').charAt(0)}
                            </AvatarFallback>
                        </Avatar>
                        <div className="text-left space-y-0.5">
                            <p className="font-black uppercase text-[11px] tracking-widest text-slate-900">{review.clientName}</p>
                            <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest opacity-60">
                                {formatDistanceToNow(parseISO(review.createdAt), { addSuffix: true })} &middot; {review.serviceName}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
            {idx < sortedReviews.length - 1 && idx < 3 && (
                <div className="h-px w-full bg-gradient-to-r from-transparent via-border/50 to-transparent my-12" />
            )}
          </motion.div>
        ))}
      </div>
      
      {reviews.length > 4 && (
          <div className="pt-10 text-center">
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground opacity-40">
                  + {reviews.length - 4} additional verified testimonials in archive
              </p>
          </div>
      )}
    </section>
  );
};
