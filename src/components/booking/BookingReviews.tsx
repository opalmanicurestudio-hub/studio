
'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { motion } from 'framer-motion';
import { Star } from 'lucide-react';

const reviews = [
  { name: 'Jessica P.', text: "Absolutely in love with my hair! The best salon experience I've ever had. So professional and talented.", avatar: 'https://picsum.photos/seed/rev1/40/40', rating: 5 },
  { name: 'Mark T.', text: "Great haircut and a fantastic atmosphere. I've finally found my go-to spot. Highly recommend!", avatar: 'https://picsum.photos/seed/rev2/40/40', rating: 5 },
  { name: 'Samantha L.', text: "My nails have never looked better. The attention to detail is incredible. I'll definitely be back.", avatar: 'https://picsum.photos/seed/rev3/40/40', rating: 5 },
];

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
    }
  },
};


export const BookingReviews = () => {
  return (
    <section className="space-y-6">
      <h2 className="text-3xl font-bold text-center">What Our Clients Say</h2>
      <motion.div
        className="grid md:grid-cols-3 gap-6"
        variants={containerVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.3 }}
      >
        {reviews.map((review, index) => (
          <motion.div key={index} variants={itemVariants} className="h-full">
            <Card className="bg-muted/50 h-full flex flex-col">
              <CardContent className="p-6 text-center flex flex-col flex-1 items-center">
                <div className="flex mb-3">
                    {Array.from({ length: review.rating }).map((_, i) => (
                        <Star key={i} className="w-5 h-5 text-amber-400 fill-amber-400" />
                    ))}
                </div>
                <p className="text-muted-foreground mb-6 flex-1">"{review.text}"</p>
                <div className="flex items-center justify-center gap-3 mt-auto">
                  <Avatar className="w-10 h-10">
                    <AvatarImage src={review.avatar} />
                    <AvatarFallback>{review.name.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <p className="font-semibold">{review.name}</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
};
