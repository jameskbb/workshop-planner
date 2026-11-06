import * as LabelPrimitive from '@radix-ui/react-label';
import * as React from 'react';
import { cn } from '@/utils/cn';

export const inputClass =
  'h-7 w-full min-w-0 rounded-md border border-line bg-panel-2 px-2 text-[13px] text-ink placeholder:text-ink-faint outline-none transition-colors hover:border-line-strong focus:border-select focus:bg-panel disabled:opacity-50 aria-[invalid=true]:border-danger';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(inputClass, className)} {...props} />
));
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(inputClass, 'h-auto min-h-16 py-1.5 leading-snug', className)} {...props} />
));
Textarea.displayName = 'Textarea';

export const Label = React.forwardRef<React.ElementRef<typeof LabelPrimitive.Root>, React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>>(
  ({ className, ...props }, ref) => <LabelPrimitive.Root ref={ref} className={cn('text-xs text-ink-muted select-none', className)} {...props} />,
);
Label.displayName = 'Label';
