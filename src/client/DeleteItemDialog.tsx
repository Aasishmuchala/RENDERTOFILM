import { useInFlight } from './lib/useInFlight.ts';
import { trpc } from './trpc.ts';
import { ConfirmDialog } from './ui/ConfirmDialog.tsx';

export type DeleteTarget = { kind: 'still' | 'clip'; id: string; title: string };

export type DeleteItemDialogProps = {
  target: DeleteTarget | null;
  onClose: () => void;
  /** After the item is gone (the library is already refreshed). */
  onDeleted?: ((target: DeleteTarget) => void) | undefined;
};

/** Confirms and deletes one still or clip from the visitor's library. */
export function DeleteItemDialog({ target, onClose, onDeleted }: DeleteItemDialogProps) {
  const utils = trpc.useUtils();
  const library = trpc.library.useQuery(undefined, { enabled: target !== null });
  const remove = trpc.deleteItem.useMutation();

  const copies =
    target?.kind === 'still'
      ? (library.data?.stills ?? []).filter((s) => s.upscaleOf === target.id).length
      : (library.data?.clips ?? []).filter((c) => c.upscaleOf === target?.id).length;
  const clips =
    target?.kind === 'still'
      ? (library.data?.clips ?? []).filter((c) => c.stillId === target.id).length
      : 0;
  const noun = target?.kind === 'clip' ? 'video' : 'film still';

  const close = () => {
    remove.reset();
    onClose();
  };
  // A double-click's second press lands before `isPending` disables the button.
  const guard = useInFlight();
  const confirm = async () => {
    if (!target || !guard.start()) return;
    try {
      await remove.mutateAsync({ kind: target.kind, id: target.id });
      await utils.library.invalidate();
      onDeleted?.(target);
      close();
    } catch {
      // Shown in the dialog; it stays open so the visitor can retry.
    } finally {
      guard.end();
    }
  };

  return (
    <ConfirmDialog
      isOpen={target !== null}
      title={`Delete this ${noun}?`}
      confirmLabel="Delete"
      loading={remove.isPending}
      error={remove.error ? `Couldn't delete it: ${remove.error.message}` : undefined}
      onConfirm={() => void confirm()}
      onCancel={close}
    >
      <p>
        <strong>{target?.title}</strong> will be removed from your library. This can't be undone.
      </p>
      {copies > 0 && (
        <p>
          Its {copies === 1 ? 'upscaled copy goes' : `${copies} upscaled copies go`} with it.
        </p>
      )}
      {clips > 0 && (
        <p>
          The {clips === 1 ? 'video' : `${clips} videos`} you made from it stay in your library.
        </p>
      )}
      <p>It stays in your Runway account history.</p>
    </ConfirmDialog>
  );
}
