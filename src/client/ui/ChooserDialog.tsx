import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';

import { Button } from './Button.tsx';
import styles from './ChooserDialog.module.css';

export type ChooserDialogProps = {
  isOpen: boolean;
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
};

/** A roomy modal to choose something in (an image, say). Escape or Close backs out. */
export function ChooserDialog({ isOpen, title, children, onClose }: ChooserDialogProps) {
  return (
    <ModalOverlay
      className={styles.overlay}
      isOpen={isOpen}
      isDismissable
      onOpenChange={(open) => !open && onClose()}
    >
      <Modal className={styles.modal}>
        <Dialog className={styles.dialog}>
          <div className={styles.head}>
            <Heading slot="title" className={styles.title}>
              {title}
            </Heading>
            <Button
              size="sm"
              variant="ghost"
              icon={<X size={14} />}
              aria-label="Close"
              onPress={onClose}
            />
          </div>
          <div className={styles.body}>{children}</div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
