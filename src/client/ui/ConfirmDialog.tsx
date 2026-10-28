import type { ReactNode } from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';

import { Alert } from './Alert.tsx';
import { Button } from './Button.tsx';
import styles from './ConfirmDialog.module.css';

export type ConfirmDialogProps = {
  isOpen: boolean;
  title: ReactNode;
  children?: ReactNode | undefined;
  /** The verb on the confirm button ("Delete"). */
  confirmLabel: string;
  /** Shows the confirm button working and keeps the dialog open. */
  loading?: boolean | undefined;
  /** Why the last attempt failed, shown above the buttons. */
  error?: string | undefined;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Asks before something destructive. Escape or Cancel backs out. */
export function ConfirmDialog({
  isOpen,
  title,
  children,
  confirmLabel,
  loading = false,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <ModalOverlay
      className={styles.overlay}
      isOpen={isOpen}
      isDismissable={!loading}
      isKeyboardDismissDisabled={loading}
      onOpenChange={(open) => !open && onCancel()}
    >
      <Modal className={styles.modal}>
        <Dialog role="alertdialog" className={styles.dialog}>
          <Heading slot="title" className={styles.title}>
            {title}
          </Heading>
          {children && <div className={styles.body}>{children}</div>}
          {error && <Alert tone="error" title={error} />}
          <div className={styles.actions}>
            <Button onPress={onCancel} disabled={loading} autoFocus>
              Cancel
            </Button>
            <Button variant="danger" onPress={onConfirm} loading={loading}>
              {confirmLabel}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
