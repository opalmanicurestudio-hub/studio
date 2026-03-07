'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Plus, Calendar, PlusCircle, Sparkles, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FloatingActionButtonProps {
  onNewAppointmentClick: () => void;
  onNewEventClick: () => void;
}

export const FloatingActionButton: React.FC<FloatingActionButtonProps> = ({
  onNewAppointmentClick,
  onNewEventClick,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const toggleOpen = () => setIsOpen(!isOpen);

  const containerVariants = {
    closed: {
      transition: {
        staggerChildren: 0.05,
        staggerDirection: -1,
      },
    },
    open: {
      transition: {
        staggerChildren: 0.07,
        delayChildren: 0.2,
      },
    },
  };

  const itemVariants = {
    closed: {
      y: 20,
      opacity: 0,
      scale: 0.8,
      transition: {
        y: { stiffness: 1000 },
      },
    },
    open: {
      y: 0,
      opacity: 1,
      scale: 1,
      transition: {
        y: { stiffness: 1000, velocity: -100 },
      },
    },
  };
  
  const handleActionClick = (action: () => void) => {
    action();
    setIsOpen(false);
  }

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 lg:hidden"
            onClick={toggleOpen}
          />
        )}
      </AnimatePresence>

      <div className="fixed bottom-8 right-8 z-50 flex flex-col items-end gap-4 lg:hidden">
        <AnimatePresence>
          {isOpen && (
            <motion.div
              variants={containerVariants}
              initial="closed"
              animate="open"
              exit="closed"
              className="flex flex-col items-end gap-4 mb-4"
            >
              {/* New Event Button */}
              <motion.div variants={itemVariants} className="flex items-center gap-4 group">
                <span className="bg-white/95 backdrop-blur-xl border-2 border-primary/10 px-5 py-2.5 rounded-2xl shadow-2xl font-black uppercase text-[10px] tracking-[0.2em] text-slate-900">
                  New Event
                </span>
                <Button
                  className="rounded-2xl shadow-2xl h-14 w-14 border-4 border-white bg-primary text-white hover:bg-primary/90 transition-transform active:scale-90"
                  size="icon"
                  onClick={() => handleActionClick(onNewEventClick)}
                >
                  <PlusCircle className="h-6 w-6" />
                </Button>
              </motion.div>

              {/* New Appointment Button */}
              <motion.div variants={itemVariants} className="flex items-center gap-4 group">
                <span className="bg-white/95 backdrop-blur-xl border-2 border-primary/10 px-5 py-2.5 rounded-2xl shadow-2xl font-black uppercase text-[10px] tracking-[0.2em] text-slate-900">
                  New Session
                </span>
                <Button
                  className="rounded-2xl shadow-2xl h-14 w-14 border-4 border-white bg-primary text-white hover:bg-primary/90 transition-transform active:scale-90"
                  size="icon"
                  onClick={() => handleActionClick(onNewAppointmentClick)}
                >
                  <Calendar className="h-6 w-6" />
                </Button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Toggle Button */}
        <Button
          className="rounded-[2rem] w-20 h-20 shadow-3xl bg-primary text-white hover:bg-primary/90 transition-all active:scale-95 border-4 border-white flex flex-col items-center justify-center gap-1"
          size="lg"
          onClick={toggleOpen}
        >
          <motion.div
            animate={{ rotate: isOpen ? 45 : 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          >
            <Plus className="h-8 w-8" strokeWidth={3} />
          </motion.div>
          <span className="text-[8px] font-black uppercase tracking-widest opacity-60">Command</span>
        </Button>
      </div>
    </>
  );
};
