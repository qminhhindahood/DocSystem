'use client';

import { MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';

/**
 * Global motion gate for the Elevated Civic layer: honors each user's
 * `prefers-reduced-motion` setting by collapsing transform/layout
 * animation to instant state changes while keeping opacity transitions.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
