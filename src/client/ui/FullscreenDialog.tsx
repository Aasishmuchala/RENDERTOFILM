import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';

import { Button } from './Button.tsx';
import styles from './FullscreenDialog.module.css';

export type FullscreenDialogProps = {
  isOpen: boolean;
  title: ReactNode;
  /** The picture, filling the dark screen. */
  children: ReactNode;
  /** The panel beside the picture (below it on a phone). */
  aside?: ReactNode | undefined;
  onClose: () => void;
  /** Arrow buttons (and the arrow keys) step between items. */
  onPrev?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
};

/** Arrow keys mean "next" only when they aren't moving a control. */
function ownsArrows(target: EventTarget): boolean {
  return target instanceof HTMLElement && target.closest('input, textarea, [role="slider"], [role="listbox"], [role="option"], [role="combobox"]') !== null;
}

/**
 * A big-screen view: the whole window goes dark, the picture fills it and a
 * panel sits beside it. Escape or Close backs out; the arrow keys step.
 */
export function FullscreenDialog({ isOpen, title, children, aside, onClose, onPrev, onNext }: FullscreenDialogProps) {
  function onKeyDown(e: KeyboardEvent) {
    if (ownsArrows(e.target)) return;
    if (e.key === 'ArrowLeft' && onPrev) {
      e.preventDefault();
      onPrev();
    } else if (e.key === 'ArrowRight' && onNext) {
      e.preventDefault();
      onNext();
    }
  }
  return (
    <ModalOverlay className={styles.overlay} isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Modal className={styles.modal}>
        <Dialog className={styles.dialog}>
          <div className={styles.inner} data-stage onKeyDown={onKeyDown}>
            <div className={styles.bar}>
              <Heading slot="title" className={styles.title}>
                {title}
              </Heading>
              <div className={styles.nav}>
                {(onPrev || onNext) && (
                  <>
                    <Button size="sm" variant="ghost" icon={<ChevronLeft size={14} />} aria-label="Previous" onPress={onPrev} disabled={!onPrev} />
                    <Button size="sm" variant="ghost" icon={<ChevronRight size={14} />} aria-label="Next" onPress={onNext} disabled={!onNext} />
                  </>
                )}
                <Button size="sm" variant="ghost" icon={<X size={14} />} aria-label="Close" onPress={onClose} />
              </div>
            </div>
            <div className={styles.body}>
              <div className={styles.stage}>{children}</div>
              {aside && <div className={styles.aside}>{aside}</div>}
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
