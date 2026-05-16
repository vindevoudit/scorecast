// Tier 11 Chunk 2 — ConfirmModal rebuilt on Radix Dialog. Radix gives us
// focus trap, Escape-to-close, click-outside-to-close, and aria-modal for
// free. The `role="dialog"` Playwright selectors keep working because
// Radix's Content renders it.

import { Button } from './ui';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from './ui/Dialog';

function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}) {
  // Radix expects `onOpenChange` with a boolean; mirror that to onCancel
  // when the user dismisses via Escape / overlay click.
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onCancel?.())}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ConfirmModal;
