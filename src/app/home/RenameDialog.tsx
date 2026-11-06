import { useState } from 'react';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Label } from '@/components/ui';

export function RenameDialog({
  open,
  onOpenChange,
  initial,
  title,
  onSubmit,
}: {
  open: boolean;
  onOpenChange(o: boolean): void;
  initial: string;
  title: string;
  onSubmit(name: string): void;
}) {
  const [name, setName] = useState(initial);
  const valid = name.trim().length > 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            onSubmit(name.trim());
            onOpenChange(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <Label htmlFor="rename-input">Name</Label>
          <Input id="rename-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} className="mt-1 h-8" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!valid}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
