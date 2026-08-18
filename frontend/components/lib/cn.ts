import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// tailwind-merge cannot infer which custom `text-*` keys are sizes and which are
// colors. Without this, a size class such as `text-body` is treated as a color and
// silently removes `text-on-action` from the same element.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'page-title',
            'section-title',
            'body',
            'control',
            'metadata',
            'technical',
          ],
        },
      ],
      rounded: [
        { rounded: ['workspace', 'panel', 'control', 'compact', 'pill'] },
      ],
      shadow: [{ shadow: ['workspace', 'floating'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
