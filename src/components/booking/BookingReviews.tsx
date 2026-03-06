
'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { motion } from 'framer-motion';
import { Star, Loader, Quote } from 'lucide-react';
import { useFirebase, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { collection, query, where, doc } from 'firebase/firestore';
import { type Review, type Tenant } from '@/lib/data';
import { useParams } from 'next/navigation';
import { cn } from '@/lib/utils';

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
  
  if (isLoading || tenant?.bookingPageSettings?.showReviews === false) return null;
  if (!reviews || reviews.length === 0) return null;

  return (
    <section id="reviews" className="space-y-12">
      <div className="space-y-4">
        <h2 className="text-3xl font-black tracking-tighter uppercase text-slate-900">{tenant?.bookingPageSettings?.reviewsSectionTitle || 'Voices'}</h2>
        <p className="text-muted-foreground font-medium uppercase tracking-[0.2em] text-[10px]">Real stories from our clients</p>
      </div>

      <div className="space-y-6">
        {reviews.slice(0, 3).map((review, idx) => (
          <motion.div 
            key={review.id}
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.1 }}
            viewport={{ once: true }}
          >
            <div className="relative group">
                <Quote className="absolute -top-4 -left-4 w-12 h-12 text-primary opacity-10 group-hover:opacity-20 transition-opacity" />
                <div className="space-y-4 pl-6">
                    <p className="text-lg md:text-xl font-medium text-slate-700 leading-relaxed italic">
                        "{review.text}"
                    </p>
                    <div className="flex items-center gap-4">
                        <Avatar className="w-10 h-10 border-2 border-primary/20">
                            <AvatarImage src={review.clientAvatarUrl} />
                            <AvatarFallback>{review.clientName.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div>
                            <p className="font-black uppercase text-[10px] tracking-widest">{review.clientName}</p>
                            <div className="flex mt-0.5">
                                {Array.from({ length: 5 }).map((_, i) => (
                                    <Star key={i} className={cn("w-2.5 h-2.5", i < review.rating ? "text-amber-400 fill-current" : "text-muted opacity-30")} />
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            {idx < 2 && <div className="h-px w-full bg-border my-8 border-dashed" />}
          </motion.div>
        ))}
      </div>
    </section>
  );
};
