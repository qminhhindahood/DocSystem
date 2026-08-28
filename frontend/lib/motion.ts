'use client';

import type { Transition, Variants } from 'motion/react';

/**
 * Elevated Civic choreography presets.
 *
 * Entrances use the decelerate token curve; interactive feedback uses
 * springs. Global reduced-motion handling lives in <MotionConfig
 * reducedMotion="user"> (components/providers/MotionProvider) — transform
 * and layout animations collapse to instant state changes there, so no
 * preset needs a per-call reduced-motion branch for basic correctness.
 */

/** Press feedback, toggles, sliding active pills over short distances. */
export const springSnappy: Transition = {
  type: 'spring',
  stiffness: 480,
  damping: 34,
  mass: 0.9,
};

/** Layout shifts that travel farther: card reorder, panel expansion. */
export const springSoft: Transition = {
  type: 'spring',
  stiffness: 260,
  damping: 30,
};

const DECELERATE: [number, number, number, number] = [0.05, 0.7, 0.1, 1];

/** Standard section/card entrance. */
export const fadeRise: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.48, ease: DECELERATE } },
};

/** Entrance with a per-instance delay passed through the `custom` prop. */
export const fadeRiseDelayed: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: (delay: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.48, ease: DECELERATE, delay },
  }),
};

/** Subtle entrance for elements that must not move much (dense UI). */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.32, ease: 'easeOut' } },
};

/**
 * Line-mask reveal for hero headlines. Wrap each line in an
 * overflow-hidden block and animate the inner span.
 */
export const maskLine: Variants = {
  hidden: { y: '112%' },
  visible: { y: '0%', transition: { duration: 0.62, ease: DECELERATE } },
};

/** Parent container that staggers fadeRise/maskLine children. */
export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

/** Slower editorial staggering for landing sections. */
export const staggerEditorial: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.14 } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.36, ease: DECELERATE } },
};

/** List item enter/exit (job cards, file chips, toasts). */
export const listItem: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.32, ease: DECELERATE } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.16, ease: 'easeIn' } },
};

/** Radix-style overlays driven through AnimatePresence. */
export const overlayFade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

export const dialogRise: Variants = {
  hidden: { opacity: 0, y: 12, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.3, ease: DECELERATE },
  },
  exit: { opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.15, ease: 'easeIn' } },
};
