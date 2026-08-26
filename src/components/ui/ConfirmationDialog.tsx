"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, LucideIcon } from "lucide-react";

export interface ConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  icon?: LucideIcon;
  iconClass?: string;
  loading?: boolean;
  destructive?: boolean;
  onClose?: () => void;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  icon: Icon = AlertTriangle,
  iconClass,
  loading,
  destructive = false,
  onClose,
  onConfirm,
}: ConfirmationDialogProps) {
  async function handleConfirm() {
    await onConfirm();
    onOpenChange(false);
  }
  return (
    <Dialog open={open} onOpenChange={(open) => {
      if (!open) onClose?.();
      onOpenChange(open);
    }}>
      <DialogContent className="sm:max-w-md border-border bg-card">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon size={18} className={iconClass ?? (destructive ? "text-red-400" : "text-amber-400")} />
            {title}
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => {
              onClose?.();
              onOpenChange(false);
            }}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "default" : "default"}
            size="sm"
            disabled={loading}
            className={
              destructive
                ? "bg-red-500/90 hover:bg-red-500"
                : "bg-amber-500/90 hover:bg-amber-500"
            }
            onClick={handleConfirm}
          >
            {loading ? "Please wait…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
