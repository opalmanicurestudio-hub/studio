
'use client';

import Image from 'next/image';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { motion } from 'framer-motion';

const galleryImages = [
  { src: 'https://images.unsplash.com/photo-1599334752327-9a4c5a3c0e5a?q=80&w=600&auto=format&fit=crop', alt: 'Stylish haircut', caption: 'Precision Cut', width: 1, height: 1 },
  { src: 'https://images.unsplash.com/photo-1604654894610-df62318589c8?q=80&w=600&auto=format&fit=crop', alt: 'Manicure', caption: 'Classic Gloss', width: 1, height: 1.2 },
  { src: 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?q=80&w=600&auto=format&fit=crop', alt: 'Facial', caption: 'Hydra-Glow', width: 1, height: 1 },
  { src: 'https://images.unsplash.com/photo-1632230198428-21943572d476?q=80&w=600&auto=format&fit=crop', alt: 'Balayage hair color', caption: 'Balayage', width: 1, height: 1.3 },
  { src: 'https://images.unsplash.com/photo-1521590832167-7ce65536845c?q=80&w=1287&auto=format&fit=crop', alt: 'Hair styling', caption: 'Event Styling', width: 1, height: 1 },
  { src: 'https://images.unsplash.com/photo-1595853035172-b366405141b4?q=80&w=1287&auto=format&fit=crop', alt: 'Nail art', caption: 'Custom Art', width: 1, height: 1.1 },
];

export const BookingGallery = () => {
  return (
    <section id="gallery" className="space-y-12 scroll-mt-24">
      <div className="text-center space-y-4">
        <h2 className="text-4xl md:text-6xl font-black tracking-tighter uppercase text-slate-900">The Vibe</h2>
        <p className="text-muted-foreground font-medium uppercase tracking-[0.2em] text-xs">Capturing our favorite moments</p>
      </div>

      <ScrollArea className="w-full pb-8">
        <div className="flex items-end space-x-6 px-4">
          {galleryImages.map((image, index) => (
            <motion.div 
                key={index} 
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.1 }}
                viewport={{ once: true }}
                className="relative shrink-0 rounded-[2.5rem] overflow-hidden group shadow-2xl"
                style={{ 
                    width: '300px', 
                    height: `${300 * image.height}px` 
                }}
            >
              <Image
                src={image.src}
                alt={image.alt}
                fill
                className="object-cover transition-transform duration-700 group-hover:scale-110"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-all duration-500 flex flex-col justify-end p-8">
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary mb-1">Portfolio</p>
                <p className="text-white font-black uppercase text-xl tracking-tighter">{image.caption}</p>
              </div>
            </motion.div>
          ))}
        </div>
        <ScrollBar orientation="horizontal" className="hidden" />
      </ScrollArea>
    </section>
  );
};
