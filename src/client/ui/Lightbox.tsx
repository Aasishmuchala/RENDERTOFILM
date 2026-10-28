import { X } from 'lucide-react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';

import { Button } from './Button.tsx';
import styles from './Lightbox.module.css';

export type LightboxProps = {
  src: string | null;
  alt: string;
  title: string;
  onClose: () => void;
};

/** Full-size view of one image. Escape or a click outside closes it. */
export function Lightbox({ src, alt, title, onClose }: LightboxProps) {
  return (
    <ModalOverlay
      className={styles.overlay}
      isOpen={src !== null}
      isDismissable
      onOpenChange={(open) => !open && onClose()}
    >
      <Modal className={styles.modal}>
        <Dialog className={styles.dialog}>
          <div className={styles.bar}>
            <Heading slot="title" className={styles.title}>
              {title}
            </Heading>
            <Button variant="ghost" size="sm" icon={<X size={14} />} aria-label="Close" onPress={onClose} />
          </div>
          {src && <img className={styles.image} src={src} alt={alt} />}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
