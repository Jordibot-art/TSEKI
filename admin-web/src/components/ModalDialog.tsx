import { useEffect, useRef, type ReactNode } from 'react';

interface ModalDialogProps {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  closedBy?: 'any' | 'closerequest' | 'none';
  className?: string;
  children: ReactNode;
}

export function ModalDialog({
  open,
  onClose,
  labelledBy,
  closedBy = 'any',
  className = '',
  children,
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.returnValue = '';
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Fallback light-dismiss for browsers without native <dialog closedby="any">
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || closedBy !== 'any' || 'closedBy' in HTMLDialogElement.prototype) {
      return;
    }

    let pressedOutside = false;
    const isOutside = (e: PointerEvent) => {
      const r = dialog.getBoundingClientRect();
      return (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      );
    };

    const onPointerDown = (e: PointerEvent) => {
      pressedOutside = isOutside(e);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (pressedOutside && isOutside(e)) {
        dialog.close();
      }
      pressedOutside = false;
    };

    dialog.addEventListener('pointerdown', onPointerDown);
    dialog.addEventListener('pointerup', onPointerUp);
    return () => {
      dialog.removeEventListener('pointerdown', onPointerDown);
      dialog.removeEventListener('pointerup', onPointerUp);
    };
  }, [closedBy]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={labelledBy}
      className={`admin-dialog ${className}`.trim()}
      {...({ closedby: closedBy } as Record<string, string>)}
      onCancel={(e) => {
        if (closedBy === 'none') {
          e.preventDefault();
        }
      }}
      onClose={() => {
        if (dialogRef.current) {
          dialogRef.current.returnValue = '';
        }
        onClose();
      }}
    >
      {open ? children : null}
    </dialog>
  );
}
