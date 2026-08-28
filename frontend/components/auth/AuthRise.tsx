'use client';

import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { fadeRiseDelayed } from '@/lib/motion';

interface AuthRiseProps {
  children: ReactNode;
  className?: string;
  delay?: number;
}

/** Mount-time rise for auth surfaces (brand panel blocks, form card). */
export function AuthRise({ children, className, delay = 0 }: AuthRiseProps) {
  return (
    <motion.div
      className={className}
      variants={fadeRiseDelayed}
      custom={delay}
      initial="hidden"
      animate="visible"
    >
      {children}
    </motion.div>
  );
}
