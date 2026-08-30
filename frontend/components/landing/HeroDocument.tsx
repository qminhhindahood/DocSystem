'use client';

import { motion } from 'motion/react';
import { Check, FileText } from 'lucide-react';
import {
  fadeRiseDelayed,
  springSnappy,
  staggerEditorial,
} from '@/lib/motion';

/**
 * Signature hero visual: a miniature of the real conversion flow.
 * A source sheet assembles line by line, a progress bar fills, then a
 * DOCX result chip springs in. Honest by construction — no invented
 * numbers, no fake file names; only the states the product actually has.
 */
export function HeroDocument() {
  return (
    <motion.div
      variants={staggerEditorial}
      initial="hidden"
      animate="visible"
      className="relative mx-auto w-full max-w-md"
      aria-hidden="true"
    >
      {/* Texture field grounding the composition. */}
      <div className="texture-dotgrid absolute -inset-6 rounded-panel sm:-inset-10" />

      {/* Back sheet: the PDF source. */}
      <motion.div
        variants={fadeRiseDelayed}
        custom={0.15}
        className="absolute inset-x-6 top-6 h-full rotate-[-3deg] rounded-panel border border-hairline bg-surface-subtle"
      />
      <motion.span
        variants={fadeRiseDelayed}
        custom={0.3}
        className="absolute -left-2 top-4 inline-flex items-center gap-1.5 rounded-pill border border-hairline bg-surface px-3 py-1 text-metadata font-medium text-text-secondary shadow-floating"
      >
        <FileText className="h-3.5 w-3.5" />
        PDF
      </motion.span>

      {/* Front sheet: the document assembling itself. */}
      <motion.div
        variants={fadeRiseDelayed}
        custom={0.05}
        className="document-sheet relative rounded-panel p-5 shadow-workspace sm:p-6"
      >
        <div className="space-y-2.5">
          {/* Title */}
          <motion.div
            variants={fadeRiseDelayed}
            custom={0.25}
            className="h-4 w-3/4 rounded-compact bg-text-primary/80"
          />
          {/* Meta line */}
          <motion.div
            variants={fadeRiseDelayed}
            custom={0.33}
            className="flex gap-2"
          >
            <div className="h-2.5 w-14 rounded-pill bg-surface-strong" />
            <div className="h-2.5 w-20 rounded-pill bg-surface-strong" />
          </motion.div>
          <div className="hairline-rule my-3 h-px bg-hairline" />

          {/* Body lines */}
          {[92, 100, 84, 96].map((width, i) => (
            <motion.div
              key={width}
              variants={fadeRiseDelayed}
              custom={0.4 + i * 0.08}
              style={{ width: `${width}%` }}
              className="h-2.5 rounded-pill bg-surface-strong"
            />
          ))}

          {/* Table block */}
          <motion.div
            variants={fadeRiseDelayed}
            custom={0.75}
            className="mt-3 grid grid-cols-3 overflow-hidden rounded-control border border-hairline"
          >
            {Array.from({ length: 9 }).map((_, i) => (
              <div
                key={i}
                className={
                  'h-7 border-hairline p-1.5 ' +
                  (i % 3 !== 2 ? 'border-r ' : '') +
                  (i < 6 ? 'border-b' : '') +
                  (i < 3 ? ' bg-surface-strong' : '')
                }
              >
                <div className={'h-full w-2/3 rounded-pill ' + (i < 3 ? 'bg-surface' : 'bg-transparent')} />
              </div>
            ))}
          </motion.div>
        </div>

        {/* Conversion progress: fills with scaleX so reduced-motion users
            get the completed state instantly. */}
        <div className="mt-5">
          <div className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-strong">
            <motion.div
              className="h-full w-full origin-left rounded-pill bg-action"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ delay: 1.05, duration: 1.1, ease: [0.05, 0.7, 0.1, 1] }}
            />
          </div>
        </div>

        {/* Result chip: springs in when the fill completes. */}
        <motion.span
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ ...springSnappy, delay: 2.1 }}
          className="absolute -right-3 top-5 inline-flex items-center gap-1.5 rounded-pill bg-success px-3 py-1 text-metadata font-semibold text-on-action shadow-floating"
        >
          <span className="check-draw flex h-3.5 w-3.5 items-center justify-center">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none">
              <path
                d="M3 8.5L6.5 12L13 4.5"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={1}
              />
            </svg>
          </span>
          Hoàn tất
        </motion.span>
      </motion.div>

      {/* DOCX label on the back sheet completes the story. */}
      <motion.span
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 2.3, duration: 0.32, ease: [0.05, 0.7, 0.1, 1] }}
        className="absolute -bottom-4 right-8 inline-flex items-center gap-1.5 rounded-pill border border-hairline bg-surface px-3 py-1 text-metadata font-semibold text-action-text shadow-floating"
      >
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
        DOCX · Nghị định 30
      </motion.span>
    </motion.div>
  );
}
