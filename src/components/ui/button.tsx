import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/utils/cn';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium select-none transition-colors disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-panel-3 text-ink hover:bg-line-strong border border-line-strong',
        primary: 'bg-accent text-accent-ink hover:bg-accent-strong font-semibold',
        ghost: 'text-ink-muted hover:bg-panel-3 hover:text-ink',
        outline: 'border border-line-strong text-ink hover:bg-panel-3',
        danger: 'bg-danger/90 text-white hover:bg-danger',
        subtle: 'bg-panel-2 text-ink hover:bg-panel-3',
        link: 'text-select underline-offset-2 hover:underline px-0',
      },
      size: {
        sm: 'h-7 px-2 text-xs',
        md: 'h-8 px-3 text-[13px]',
        lg: 'h-10 px-4 text-sm',
        icon: 'h-8 w-8',
        'icon-sm': 'h-7 w-7 [&_svg]:size-3.5',
      },
      active: { true: 'bg-panel-3 text-ink', false: '' },
    },
    defaultVariants: { variant: 'default', size: 'md', active: false },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, active, asChild, type, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button';
  return <Comp ref={ref} type={asChild ? undefined : (type ?? 'button')} className={cn(buttonVariants({ variant, size, active }), className)} {...props} />;
});
Button.displayName = 'Button';
