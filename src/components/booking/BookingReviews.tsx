
'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { motion } from 'framer-motion';
import { Star, Loader } from 'lucide-react';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { type Review } from '@/lib/data';
import { useParams } from 'next/navigation';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.2,
    },
  },
};

const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: {
      duration: 0.5,
    },
  },
};

export const BookingReviews = () => {
  const { firestore } = useFirebase();
  const params = useParams();
  const tenantId = params.tenantId as string;

  const reviewsQuery = useMemoFirebase(() => {
    if (!firestore || !tenantId) return null;
    return query(
      collection(firestore, `tenants/${tenantId}/reviews`),
      where('isPublic', '==', true)
    );
  }, [firestore, tenantId]);

  const { data: reviews, isLoading } = useCollection<Review>(reviewsQuery);
  
  if (isLoading) {
      return (
          <section id="reviews" className="space-y-6 scroll-mt-20">
              <h2 className="text-3xl font-bold text-center">What Our Clients Say</h2>
              <div className="flex justify-center">
                <Loader className="animate-spin" />
              </div>
          </section>
      )
  }
  
  if (!reviews || reviews.length === 0) {
      return null; // Don't render the section if there are no public reviews
  }

  return (
    <section id="reviews" className="space-y-6 scroll-mt-20">
      <h2 className="text-3xl font-bold text-center">What Our Clients Say</h2>
      <motion.div
        className="grid md:grid-cols-3 gap-6"
        variants={containerVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.3 }}
      >
        {reviews.map((review) => (
          <motion.div key={review.id} variants={itemVariants} className="h-full">
            <Card className="bg-card h-full flex flex-col text-left">
              <CardContent className="p-6 flex flex-col flex-1">
                <div className="flex items-center gap-4 mb-4">
                  <Avatar className="w-12 h-12">
                    <AvatarImage src={review.clientAvatarUrl} />
                    <AvatarFallback>{review.clientName.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-semibold">{review.clientName}</p>
                    <p className="text-sm text-muted-foreground">
                      Client for <span className="font-medium text-primary">{review.serviceName}</span>
                    </p>
                  </div>
                </div>
                <div className="flex mb-4">
                  {Array.from({ length: review.rating }).map((_, i) => (
                    <Star key={i} className="w-5 h-5 text-amber-400 fill-amber-400" />
                  ))}
                  {Array.from({ length: 5 - review.rating }).map((_, i) => (
                    <Star key={`empty-${i}`} className="w-5 h-5 text-amber-200/50" />
                  ))}
                </div>
                <blockquote className="text-muted-foreground flex-1 border-l-2 border-primary pl-4 italic">
                  "{review.text}"
                </blockquote>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
};
