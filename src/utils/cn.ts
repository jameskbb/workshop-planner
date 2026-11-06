import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Teach tailwind-merge our custom font-size token so `text-2xs` does not clash with text colors.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { 'font-size': [{ text: ['2xs'] }] } },
});

/** Merge Tailwind class names (shadcn convention). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
