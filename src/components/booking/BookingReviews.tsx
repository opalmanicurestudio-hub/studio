
'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { motion } from 'framer-motion';
import { Star } from 'lucide-react';

const reviews = [
  {
    name: 'Jessica P.',
    service: 'Balayage',
    text: "Absolutely in love with my hair! The best salon experience I've ever had. So professional and talented.",
    avatar: 'https://picsum.photos/seed/rev1/40/40',
    rating: 5,
  },
  {
    name: 'Mark T.',
    service: 'Signature Haircut',
    text: "Great haircut and a fantastic atmosphere. I've finally found my go-to spot. Highly recommend!",
    avatar: 'https://picsum.photos/seed/rev2/40/40',
    rating: 5,
  },
  {
    name: 'Samantha L.',
    service: 'Gel-X Manicure',
    text: "My nails have never looked better. The attention to detail is incredible. I'll definitely be back.",
    avatar: 'https://picsum.photos/seed/rev3/40/40',
    rating: 5,
  },
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
    },
  },
};

export const BookingReviews = () => {
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
        {reviews.map((review, index) => (
          <motion.div key={index} variants={itemVariants} className="h-full">
            <Card className="bg-card h-full flex flex-col text-left">
              <CardContent className="p-6 flex flex-col flex-1">
                <div className="flex items-center gap-4 mb-4">
                  <Avatar className="w-12 h-12">
                    <AvatarImage src={review.avatar} />
                    <AvatarFallback>{review.name.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-semibold">{review.name}</p>
                    <p className="text-sm text-muted-foreground">
                      Client for <span className="font-medium text-primary">{review.service}</span>
                    </p>
                  </div>
                </div>
                <div className="flex mb-4">
                  {Array.from({ length: review.rating }).map((_, i) => (
                    <Star key={i} className="w-5 h-5 text-amber-400 fill-amber-400" />
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
