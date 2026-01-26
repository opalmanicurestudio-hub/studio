'use client';

import Image from 'next/image';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

const galleryImages = [
  { src: 'https://images.unsplash.com/photo-1599334752327-9a4c5a3c0e5a?q=80&w=600&auto=format&fit=crop', alt: 'Stylish haircut', caption: 'Signature Haircut' },
  { src: 'https://images.unsplash.com/photo-1604654894610-df62318589c8?q=80&w=600&auto=format&fit=crop', alt: 'Manicure', caption: 'Classic Manicure' },
  { src: 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?q=80&w=600&auto=format&fit=crop', alt: 'Facial', caption: 'Deep Cleansing Facial' },
  { src: 'https://images.unsplash.com/photo-1632230198428-21943572d476?q=80&w=600&auto=format&fit=crop', alt: 'Balayage hair color', caption: 'Balayage' },
  { src: 'https://images.unsplash.com/photo-1521590832167-7ce65536845c?q=80&w=1287&auto=format&fit=crop', alt: 'Hair styling', caption: 'Updo / Styling' },
  { src: 'https://images.unsplash.com/photo-1595853035172-b366405141b4?q=80&w=1287&auto=format&fit=crop', alt: 'Nail art', caption: 'Gel-X Manicure' },
];

export const BookingGallery = () => {
  return (
    <section id="gallery" className="space-y-6 scroll-mt-20">
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
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                <p className="text-white font-semibold">{image.caption}</p>
              </div>
            </div>
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </section>
  );
};
