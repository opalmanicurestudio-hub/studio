'use client';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const faqItems = [
  {
    question: "What is your cancellation policy?",
    answer: "We require at least 24 hours notice for any cancellations. Cancellations made within 24 hours of the appointment may be subject to a fee.",
  },
  {
    question: "How should I prepare for my appointment?",
    answer: "For hair appointments, please arrive with clean, dry hair. For skin services, please come with a clean face, free of makeup. This ensures we have the best canvas to work with.",
  },
  {
    question: "Do you accept walk-ins?",
    answer: "We primarily operate by appointment to ensure each client gets our full attention. However, we do accept walk-ins if there are openings in the schedule. We recommend calling ahead to check for availability.",
  },
    {
    question: "What if I'm running late?",
    answer: "We have a 15-minute grace period. If you are running more than 15 minutes late, we may need to reschedule your appointment to avoid impacting other clients. Please call us as soon as you know you will be late.",
  },
];


export const BookingFAQ = () => {
  return (
    <section className="space-y-6">
      <h2 className="text-3xl font-bold text-center">Frequently Asked Questions</h2>
      <Accordion type="single" collapsible className="w-full">
        {faqItems.map((item, index) => (
          <AccordionItem key={index} value={`item-${index}`}>
            <AccordionTrigger className="text-left">{item.question}</AccordionTrigger>
            <AccordionContent>
              {item.answer}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
};
