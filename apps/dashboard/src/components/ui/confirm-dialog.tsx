import { ConfirmDialog as BasaltConfirmDialog } from '@nocoo/basalt';
import type { ReactNode } from 'react';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
  title: ReactNode;
  description: ReactNode;
  confirmText?: ReactNode;
  cancelText?: ReactNode;
  variant?: 'default' | 'destructive';
  loading?: boolean;
}

export function ConfirmDialog({ confirmText, cancelText, ...props }: ConfirmDialogProps) {
  return <BasaltConfirmDialog confirmLabel={confirmText} cancelLabel={cancelText} {...props} />;
}
