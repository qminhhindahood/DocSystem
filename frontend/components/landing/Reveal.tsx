'use client';

import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { fadeRiseDelayed } from '@/lib/motion';

interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Seconds to wait after the section enters the viewport. */
  delay?: number;
}

/** Scroll-triggered entrance used across landing sections. Fires once. */
export function Reveal({ children, className, delay = 0 }: RevealProps) {
  return (
    <motion.div
      className={className}
      variants={fadeRiseDelayed}
      custom={delay}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '0px 0px -72px 0px' }}
    >
      {children}
    </motion.div>
  );
}
