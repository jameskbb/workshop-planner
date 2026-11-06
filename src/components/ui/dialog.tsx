import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/utils/cn';
import { Button, buttonVariants } from './button';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const overlayClass = 'fixed inset-0 z-50 bg-black/55 backdrop-blur-[1px] animate-fade-in';
const contentClass =
  'fixed left-1/2 top-1/2 z-50 w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line-strong bg-panel p-5 shadow-2xl shadow-black/50 animate-pop-in focus:outline-none';

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { hideClose?: boolean }
>(({ className, children, hideClose, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className={overlayClass} />
    <DialogPrimitive.Content ref={ref} className={cn(contentClass, className)} {...props}>
      {children}
      {!hideClose && (
        <DialogPrimitive.Close asChild>
          <Button variant="ghost" size="icon-sm" className="absolute right-3 top-3" aria-label="Close">
            <X />
          </Button>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = 'DialogContent';

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mb-4 flex flex-col gap-1 pr-8', className)} {...props} />;
}
export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-5 flex justify-end gap-2', className)} {...props} />;
}
export const DialogTitle = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Title>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>>(
  ({ className, ...props }, ref) => <DialogPrimitive.Title ref={ref} className={cn('text-[15px] font-semibold text-ink', className)} {...props} />,
);
DialogTitle.displayName = 'DialogTitle';
export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => <DialogPrimitive.Description ref={ref} className={cn('text-[13px] text-ink-muted', className)} {...props} />);
DialogDescription.displayName = 'DialogDescription';

// ───────────────────────────── confirmation dialog ─────────────────────────────

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm(): void;
}

/** Confirmation for destructive actions (brief: "confirmation for destructive actions"). */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = 'Confirm', destructive, onConfirm }: ConfirmDialogProps) {
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className={overlayClass} />
        <AlertDialogPrimitive.Content className={cn(contentClass, 'w-[min(92vw,420px)]')}>
          <AlertDialogPrimitive.Title className="text-[15px] font-semibold text-ink">{title}</AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="mt-2 text-[13px] text-ink-muted">{description}</AlertDialogPrimitive.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialogPrimitive.Cancel className={buttonVariants({ variant: 'ghost' })}>Cancel</AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action className={buttonVariants({ variant: destructive ? 'danger' : 'primary' })} onClick={onConfirm}>
              {confirmLabel}
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
