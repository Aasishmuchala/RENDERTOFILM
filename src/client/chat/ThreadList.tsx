import { Plus } from 'lucide-react';
import { Button as AriaButton } from 'react-aria-components';

import type { ThreadSummary } from '../../chat/domain.ts';
import { Button } from '../ui/Button.tsx';
import styles from './ThreadList.module.css';

export type ThreadListProps = {
  /** Newest first, as the server sends them. */
  threads: ThreadSummary[];
  current: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
};

function day(ms: number) {
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** The conversations, newest first, under the way to start one. The same list in the rail and in the phone's sheet. */
export function ThreadList({ threads, current, onSelect, onNew }: ThreadListProps) {
  return (
    <div className={styles.list}>
      <Button className={styles.new} icon={<Plus size={16} aria-hidden />} onPress={onNew}>
        New chat
      </Button>
      {threads.length > 0 && (
        <ul className={styles.rows} aria-label="Chats">
          {threads.map((thread) => (
            <li key={thread.id}>
              <AriaButton
                className={styles.row}
                aria-current={thread.id === current ? 'true' : undefined}
                onPress={() => onSelect(thread.id)}
              >
                <span className={styles.title}>{thread.title}</span>
                <span className={styles.when}>{day(thread.updatedAt)}</span>
              </AriaButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
