
'use client';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { HelpCircle } from 'lucide-react';

const faqItems = [
  {
    question: "What is your cancellation policy?",
    answer: "We require at least 24 hours notice for any cancellations. Cancellations made within 24 hours of the appointment may be subject to a fee to recover our overhead costs.",
  },
  {
    question: "How should I prepare for my appointment?",
    answer: "For hair appointments, please arrive with clean, dry hair. For skin services, please come with a clean face, free of makeup. This ensures we have the best canvas to work with.",
  },
  {
    question: "Do you accept walk-ins?",
    answer: "We primarily operate by appointment to ensure each client gets our full attention. However, we do accept walk-ins if there are openings in the schedule. Check our live kiosk for real-time status.",
  },
  {
    question: "What if I'm running late?",
    answer: "We have a 15-minute grace period. Beyond that, your appointment may be auto-cancelled to respect the time of our other guests. Please let us know as soon as possible via your check-in link.",
  },
];


export const BookingFAQ = () => {
  return (
    <section className="space-y-12">
      <div className="space-y-4">
        <h2 className="text-3xl font-black tracking-tighter uppercase text-slate-900">Intel</h2>
        <p className="text-muted-foreground font-medium uppercase tracking-[0.2em] text-[10px]">Answers to common questions</p>
      </div>

      <div className="space-y-2">
        {faqItems.map((item, index) => (
          <Accordion type="single" collapsible key={index}>
            <AccordionItem value={`item-${index}`} className="border-2 border-border/50 rounded-2xl px-6 bg-card mb-3 overflow-hidden transition-all hover:border-primary/30">
                <AccordionTrigger className="text-left font-black uppercase text-[11px] tracking-widest hover:no-underline py-6">
                    {item.question}
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground leading-relaxed pb-6">
                {item.answer}
                </AccordionContent>
            </AccordionItem>
          </Accordion>
        ))}
      </div>
    </section>
  );
};
