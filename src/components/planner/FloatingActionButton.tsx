'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Plus, Calendar, PlusCircle } from 'lucide-react';
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
      transition: {
        y: { stiffness: 1000 },
      },
    },
    open: {
      y: 0,
      opacity: 1,
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
            className="fixed inset-0 bg-black/40 z-40 lg:hidden"
            onClick={toggleOpen}
          />
        )}
      </AnimatePresence>

      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3 lg:hidden">
        <AnimatePresence>
          {isOpen && (
            <motion.div
              variants={containerVariants}
              initial="closed"
              animate="open"
              exit="closed"
              className="flex flex-col items-end gap-3"
            >
              <motion.div variants={itemVariants} className="flex items-center gap-3">
                 <span className="bg-background/90 backdrop-blur-sm text-sm font-medium py-1.5 px-3 rounded-full shadow-lg">New Event</span>
                <Button
                  className="rounded-full shadow-lg h-12 w-12"
                  size="icon"
                  variant="secondary"
                  onClick={() => handleActionClick(onNewEventClick)}
                >
                  <PlusCircle className="h-6 w-6" />
                </Button>
              </motion.div>
               <motion.div variants={itemVariants} className="flex items-center gap-3">
                <span className="bg-background/90 backdrop-blur-sm text-sm font-medium py-1.5 px-3 rounded-full shadow-lg">New Appointment</span>
                <Button
                  className="rounded-full shadow-lg h-12 w-12"
                  size="icon"
                  variant="secondary"
                  onClick={() => handleActionClick(onNewAppointmentClick)}
                >
                  <Calendar className="h-6 w-6" />
                </Button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        <Button
          className="rounded-full w-16 h-16 shadow-2xl"
          size="lg"
          onClick={toggleOpen}
        >
          <motion.div
            animate={{ rotate: isOpen ? 45 : 0 }}
            transition={{ duration: 0.3 }}
          >
            <Plus className="h-7 w-7" />
          </motion.div>
        </Button>
      </div>
    </>
  );
};
