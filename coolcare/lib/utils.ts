import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Public-site typography tokens are font sizes, not text colors.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { 'font-size': [{ text: [
    'display-lg', 'display-lg-mobile', 'display-md', 'display-sm',
    'headline-lg', 'headline-md', 'headline-sm', 'title-lg', 'title-md', 'title-sm',
    'body-lg', 'body-md', 'body-sm', 'label-lg', 'label-md', 'label-sm',
  ] }] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
