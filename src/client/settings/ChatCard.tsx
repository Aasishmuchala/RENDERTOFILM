import { CircleAlert, CircleCheck } from 'lucide-react';
import { useState } from 'react';

import { Section } from '../layouts/Section.tsx';
import { errorMessage } from '../lib/runwayErrors.ts';
import { useCapabilities } from '../lib/useCapabilities.ts';
import { trpc } from '../trpc.ts';
import { Alert } from '../ui/Alert.tsx';
import { Button } from '../ui/Button.tsx';
import { NumberInput } from '../ui/NumberInput.tsx';
import { Select } from '../ui/Select.tsx';
import { SkeletonBlock } from '../ui/Skeleton.tsx';
import { Text } from '../ui/Text.tsx';
import styles from '../SettingsPage.module.css';
import own from './ChatCard.module.css';

/** The server's bound for the Allowance (`settings.setChat`). */
const ALLOWANCE_MAX = 100_000;
const UNIT_LABELS = { credits: 'credits', usd: 'USD' } as const;

/** The AI text card's heading, which the readiness line leads to. */
export const AI_TEXT_CARD = 'settings-ai-text';

/** A button and not a hash link: the address bar's hash is the page, so `#settings-ai-text` would leave Settings. */
function goToAiText() {
  const card = document.getElementById(AI_TEXT_CARD);
  card?.scrollIntoView({ block: 'start' });
  card?.focus({ preventScroll: true });
}

/**
 * The chat agent: whether it can run (it needs a direct Anthropic key, whatever
 * the planners use), its model, and the Allowance that lets a Run start without
 * a click. On Bay the Allowance stays off, because a Run's price is not known
 * there before it starts.
 */
export function ChatCard({ active }: { active: boolean }) {
  const { caps } = useCapabilities();
  const chat = trpc.settings.chat.useQuery(undefined, { enabled: active });
  const utils = trpc.useUtils();
  const refresh = () => utils.settings.chat.invalidate();
  const pick = trpc.settings.setChat.useMutation({ onSettled: refresh });
  // The Allowance is money, so the field edits a draft that only Save or Enter
  // sends: a key the number field binds (Home, the arrows, the wheel over a focused
  // field) moves the draft at most, never what is saved. A draft says it is one.
  const [draft, setDraft] = useState<number | null>(null);
  const save = trpc.settings.setChat.useMutation({
    onSuccess: async (_saved, sent) => {
      // The draft stays up until the page has read the saved value back, so the
      // field never shows the old one in between; a newer draft is left alone.
      await refresh();
      setDraft((now) => (now === sent.allowancePerDay ? null : now));
    },
  });
  const data = chat.data;
  const model = pick.isPending ? (pick.variables.model ?? data?.model) : data?.model;
  const allowance = draft ?? data?.allowancePerDay ?? 0;
  const tooHigh = allowance > ALLOWANCE_MAX;
  const changed = draft !== null && draft !== data?.allowancePerDay;
  // Save stays pressable with nothing to send or a number too high: pressing it
  // blurs the field, which commits a number typed without Enter, and a button
  // disabled at that moment would lose the press.
  const submit = () => {
    if (changed && !tooHigh) save.mutate({ allowancePerDay: allowance });
  };
  const error = pick.error ?? save.error;
  const Glyph = data?.ready ? CircleCheck : CircleAlert;

  return (
    <Section title="Chat" description="The agent on the Chat page plans, prices and runs your film, on your own Anthropic key.">
      {chat.error ? (
        <Alert tone="error" title={errorMessage(chat.error) ?? 'Your chat settings did not load.'} />
      ) : !data ? (
        <SkeletonBlock height={160} />
      ) : (
        <div className={styles.card}>
          <div className={`${styles.cardHead} ${own.head}`}>
            <Glyph className={own.glyph} size={16} aria-hidden />
            <div className={`${styles.cardTitle} ${own.title}`}>
              <Text>{data.ready ? 'Chat is ready' : 'Chat needs an Anthropic key'}</Text>
            </div>
            {!data.ready && (
              <Button size="sm" variant="ghost" onPress={goToAiText}>
                Go to AI text and vision
              </Button>
            )}
          </div>
          <div className={styles.row}>
            <div className={styles.grow}>
              <Select
                label="Model"
                options={data.models.map((m) => ({ id: m.id, name: m.name }))}
                value={model ?? ''}
                disabled={pick.isPending}
                onChange={(id) => {
                  if (id !== data.model) pick.mutate({ model: id });
                }}
              />
            </div>
            {/* On key up: the field keeps Enter's key down to itself, to commit the number. */}
            <div
              className={own.allowance}
              onKeyUp={(e) => {
                if (e.key === 'Enter') submit();
              }}
            >
              {/* No `max`: the number field would bind End, the cursor key, to a jump to it. The server holds the bound. */}
              <NumberInput
                label="Allowance per day"
                value={allowance}
                min={0}
                step={data.unit === 'usd' ? 0.01 : 1}
                unit={UNIT_LABELS[data.unit]}
                disabled={!caps.desktop}
                onChange={setDraft}
              />
            </div>
            {caps.desktop && (
              <Button className={styles.fieldButton} variant="primary" loading={save.isPending} onPress={submit}>
                Save
              </Button>
            )}
          </div>
          {tooHigh && (
            <Text tone="muted" size="sm" as="p">
              {`At most ${ALLOWANCE_MAX.toLocaleString()} ${UNIT_LABELS[data.unit]} a day.`}
            </Text>
          )}
          {changed && !save.isPending && !tooHigh && (
            <Text className={own.note} size="sm" as="p">
              {`Not saved. ${data.allowancePerDay.toLocaleString()} ${UNIT_LABELS[data.unit]} a day is in force.`}
            </Text>
          )}
          <Text className={own.note} tone="muted" size="sm" as="p">
            Nothing runs above this without your yes. 0 means always ask.
            {!caps.desktop && ' Here every run asks: its price is not known before it starts.'}
          </Text>
          {error && <Alert tone="error" title={errorMessage(error) ?? 'That change was not saved.'} />}
        </div>
      )}
    </Section>
  );
}
