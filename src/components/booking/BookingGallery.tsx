
'use client';

import Image from 'next/image';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

const galleryImages = [
  { src: 'https://images.unsplash.com/photo-1599334752327-9a4c5a3c0e5a?q=80&w=600&auto=format&fit=crop', alt: 'Stylish haircut' },
  { src: 'https://images.unsplash.com/photo-1604654894610-df62318589c8?q=80&w=600&auto=format&fit=crop', alt: 'Manicure' },
  { src: 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?q=80&w=600&auto=format&fit=crop', alt: 'Facial' },
  { src: 'https://images.unsplash.com/photo-1632230198428-21943572d476?q=80&w=600&auto=format&fit=crop', alt: 'Balayage hair color' },
  { src: 'https://images.unsplash.com/photo-1521590832167-7ce65536845c?q=80&w=1287&auto=format&fit=crop', alt: 'Hair styling' },
  { src: 'https://images.unsplash.com/photo-1595853035172-b366405141b4?q=80&w=1287&auto=format&fit=crop', alt: 'Nail art' },
];

export const BookingGallery = () => {
  return (
    <section className="space-y-6">
      <h2 className="text-3xl font-bold text-center">Our Work</h2>
      <ScrollArea>
        <div className="flex space-x-4 pb-4">
          {galleryImages.map((image, index) => (
            <div key={index} className="relative aspect-square w-64 h-64 md:w-80 md:h-80 flex-shrink-0 rounded-xl overflow-hidden group">
              <Image
                src={image.src}
                alt={image.alt}
                fill
                className="object-cover transition-transform duration-300 group-hover:scale-110"
              />
            </div>
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </section>
  );
};
