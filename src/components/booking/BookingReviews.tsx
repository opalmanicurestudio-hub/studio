
'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

const reviews = [
  { name: 'Jessica P.', text: "Absolutely in love with my hair! The best salon experience I've ever had. So professional and talented.", avatar: 'https://picsum.photos/seed/rev1/40/40' },
  { name: 'Mark T.', text: "Great haircut and a fantastic atmosphere. I've finally found my go-to spot. Highly recommend!", avatar: 'https://picsum.photos/seed/rev2/40/40' },
  { name: 'Samantha L.', text: "My nails have never looked better. The attention to detail is incredible. I'll definitely be back.", avatar: 'https://picsum.photos/seed/rev3/40/40' },
];

export const BookingReviews = () => {
  return (
    <section className="space-y-6">
      <h2 className="text-3xl font-bold text-center">What Our Clients Say</h2>
      <div className="grid md:grid-cols-3 gap-6">
        {reviews.map((review, index) => (
          <Card key={index} className="bg-muted/50">
            <CardContent className="p-6 text-center">
              <p className="text-muted-foreground mb-4">"{review.text}"</p>
              <div className="flex items-center justify-center gap-3">
                <Avatar className="w-8 h-8">
                  <AvatarImage src={review.avatar} />
                  <AvatarFallback>{review.name.charAt(0)}</AvatarFallback>
                </Avatar>
                <p className="font-semibold">{review.name}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
};
