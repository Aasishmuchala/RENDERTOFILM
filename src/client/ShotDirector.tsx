import { Check, Plus, RotateCcw } from 'lucide-react';
import { type ReactNode, useId, useRef } from 'react';
import { Checkbox } from 'react-aria-components';

import { MOTIONS, type MotionId } from '../models.ts';
import { allowedMoves, type ShotContext, type ShotPlanRaw, shotSummary } from '../shot-director.ts';
import type { useShotPlan } from './lib/useShotPlan.ts';
import { Alert } from './ui/Alert.tsx';
import { Button } from './ui/Button.tsx';
import { NumberInput } from './ui/NumberInput.tsx';
import { RunwayErrorNotice } from './ui/RunwayErrorNotice.tsx';
import { Select, type SelectOption } from './ui/Select.tsx';
import { Switch } from './ui/Switch.tsx';
import { Text } from './ui/Text.tsx';
import { TextArea } from './ui/TextArea.tsx';
import { TextInput } from './ui/TextInput.tsx';
import styles from './ShotDirector.module.css';

/** Beats the editor offers, and the fewest the resolver keeps before it falls back to its own two. */
const MAX_BEATS = 5;
const MIN_BEATS = 2;
/** Things that move at once; the resolver keeps no more. */
const MAX_MOVING = 6;
/** The focus Selects' "None": not a valid inventory id, so it never collides with one. */
const NO_FOCUS = '_none';

export type ShotDirectorProps = {
  shot: ReturnType<typeof useShotPlan>;
  context: ShotContext | null;
  seconds: number;
  /** Shown instead of the camera Select when something else sets the camera (Recreate's reference clip). */
  cameraLocked?: string | undefined;
  disabled?: boolean | undefined;
  /** A field under the switch while it is on (the Video tab's Direction style). */
  styleField?: ReactNode | undefined;
};

const moveName = (id: MotionId) => MOTIONS.find((m) => m.id === id)?.name ?? id;

/**
 * The shot director's control (src/client/lib/useShotPlan.ts): the switch,
 * then what the director is doing, and once a plan is back the plan itself:
 * what it found in the picture, what it changed to keep to the picture, and
 * every choice as a field (camera, what moves, people, beats, focus, the end).
 * Nothing here bills; the page's primary button makes the video.
 */
export function ShotDirector({ shot, context, seconds, cameraLocked, disabled = false, styleField }: ShotDirectorProps) {
  const { enabled, state, stale, resolved, planning } = shot;
  const canDirect = !disabled && context !== null;
  return (
    <div className={styles.director}>
      <Switch
        label="Direct the shot"
        hint={
          enabled
            ? 'An AI director reads the image and plans the camera, what moves and the timing from what is really there. Nothing new is added.'
            : 'Off: the camera preset and your direction are used as they are.'
        }
        checked={enabled}
        onChange={shot.setEnabled}
        disabled={disabled}
      />
      {enabled && (
        <>
          {styleField}
          <div role="status" aria-live="polite" className={styles.live}>
            {planning && (
              <Text tone="muted" size="sm" as="p" className={styles.line}>
                Directing the shot…
              </Text>
            )}
          </div>
          {!planning && (
            <RunwayErrorNotice error={shot.planError} modelName="the shot director" onRetry={() => void shot.direct()} />
          )}
          {!planning && state.kind === 'idle' && !shot.planError && (
            <Text tone="muted" size="sm" as="p" className={styles.line}>
              Press Direct the shot to plan this clip from the image. It is one text call; the video is not billed
              until you make it.
            </Text>
          )}
          {!planning && state.kind === 'failed' && (
            <div className={styles.stack}>
              <Alert tone="error" title="The director could not plan this shot">
                {state.error}
              </Alert>
              <div>
                <Button size="sm" icon={<RotateCcw size={14} />} disabled={!canDirect} onPress={() => void shot.direct()}>
                  Try again
                </Button>
              </div>
            </div>
          )}
          {!planning && state.kind === 'ready' && (
            <>
              {stale && (
                <Alert
                  tone="info"
                  title="The image, frames, model or clip length changed since this plan. Direct again to plan from the current picture."
                />
              )}
              {resolved && context && (
                <PlanEditor
                  raw={state.raw}
                  shot={shot}
                  context={context}
                  seconds={seconds}
                  cameraLocked={cameraLocked}
                  locked={disabled || stale}
                />
              )}
              <div>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<RotateCcw size={14} />}
                  disabled={!canDirect}
                  onPress={() => void shot.direct()}
                >
                  Direct again
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** The plan on screen: every edit goes back through `shot.update`, ids kept. */
function PlanEditor({
  raw,
  shot,
  context,
  seconds,
  cameraLocked,
  locked,
}: {
  raw: ShotPlanRaw;
  shot: ReturnType<typeof useShotPlan>;
  context: ShotContext;
  seconds: number;
  cameraLocked: string | undefined;
  locked: boolean;
}) {
  const resolved = shot.resolved!;
  const uid = useId();
  const edit = (next: Partial<ShotPlanRaw>) => shot.update({ ...raw, ...next });
  const { camera } = resolved;

  const moveOptions: SelectOption[] = allowedMoves(context).map((id) => {
    const m = MOTIONS.find((x) => x.id === id)!;
    return { id: m.id, name: m.name, hint: m.hint, group: m.group };
  });

  const movers = resolved.inventory.filter((i) => i.moves);
  const movingIds = new Set(resolved.moving.map((m) => m.item.id));
  const moversFull = movingIds.size >= MAX_MOVING;
  // An untick keeps its "how" here, so ticking it again brings the words back.
  const unticked = useRef(new Map<string, string>());
  const order = (id: string) => {
    const at = raw.inventory.findIndex((i) => i.id === id);
    return at < 0 ? raw.inventory.length : at;
  };
  const toggleMover = (id: string, on: boolean) => {
    const was = raw.moving.find((m) => m.id === id);
    if (!on && was) unticked.current.set(id, was.how);
    edit({
      moving: on
        ? [...raw.moving.filter((m) => m.id !== id), { id, how: was?.how ?? unticked.current.get(id) ?? '' }].sort(
            (a, b) => order(a.id) - order(b.id)
          )
        : raw.moving.filter((m) => m.id !== id),
    });
  };
  const setHow = (id: string, how: string) =>
    edit({ moving: raw.moving.map((m) => (m.id === id ? { ...m, how } : m)) });

  const setBeat = (i: number, patch: Partial<ShotPlanRaw['beats'][number]>) =>
    edit({ beats: raw.beats.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const addBeat = () => edit({ beats: [...raw.beats, { at: nextBeatAt(raw.beats), what: '' }] });
  const removeBeat = (i: number) => edit({ beats: raw.beats.filter((_, j) => j !== i) });

  const known = new Set(resolved.inventory.map((i) => i.id));
  const focusOptions: SelectOption[] = [
    { id: NO_FOCUS, name: 'None' },
    ...resolved.inventory.map((i) => ({ id: i.id, name: i.name })),
  ];
  const focusStart = raw.focus && known.has(raw.focus.start) ? raw.focus.start : NO_FOCUS;
  const focusEnd = raw.focus && known.has(raw.focus.end) ? raw.focus.end : NO_FOCUS;
  const setFocus = (start: string, end: string) => {
    const s = start === NO_FOCUS ? '' : start;
    const e = end === NO_FOCUS ? '' : end;
    edit({ focus: s || e ? { start: s, end: e } : null });
  };

  return (
    <div className={styles.plan} data-stale={locked || undefined}>
      <p className={styles.summary}>{shotSummary(resolved)}</p>

      <div className={styles.group} role="group" aria-labelledby={`${uid}-inventory`}>
        <h3 id={`${uid}-inventory`} className={styles.groupTitle}>
          In the picture
        </h3>
        <ul className={styles.chips}>
          {resolved.inventory.map((item) => (
            <li key={item.id} className={styles.chip} title={item.where || undefined}>
              {item.name}
            </li>
          ))}
        </ul>
        <Text tone="muted" size="sm" as="p" className={styles.line}>
          The clip shows only these, as they are in the image. Nothing else is added.
        </Text>
      </div>

      {resolved.notes.length > 0 && (
        <Alert tone="info" title="What the director changed">
          <ul className={styles.notes}>
            {resolved.notes.map((n, i) => (
              <li key={`${i}-${n}`}>{n}</li>
            ))}
          </ul>
        </Alert>
      )}

      <div className={styles.group}>
        {cameraLocked ? (
          <>
            <h3 className={styles.groupTitle}>Camera</h3>
            <Text tone="muted" size="sm" as="p" className={styles.line}>
              {cameraLocked}
            </Text>
          </>
        ) : (
          <>
            <Select
              label="Camera move"
              options={moveOptions}
              value={camera.move}
              onChange={(id) => edit({ camera: { ...raw.camera, move: id } })}
              disabled={locked}
              showHint={false}
            />
            {camera.downgradedFrom && (
              <Text tone="muted" size="sm" as="p" className={styles.line}>
                {`${moveName(camera.downgradedFrom)} would reveal space outside the image; the director uses ${moveName(camera.move)}.`}
              </Text>
            )}
            {camera.why && (
              <Text tone="muted" size="sm" as="p" className={styles.line}>
                {camera.why}
              </Text>
            )}
          </>
        )}
      </div>

      <div className={styles.group} role="group" aria-labelledby={`${uid}-moves`}>
        <h3 id={`${uid}-moves`} className={styles.groupTitle}>
          What moves
        </h3>
        {movers.length === 0 ? (
          <Text tone="muted" size="sm" as="p" className={styles.line}>
            Nothing in this picture moves in life, so the scene holds still.
          </Text>
        ) : (
          <ul className={styles.movers}>
            {movers.map((item) => {
              const on = movingIds.has(item.id);
              return (
                <li key={item.id} className={styles.mover}>
                  <Checkbox
                    className={styles.check}
                    isSelected={on}
                    isDisabled={locked || (!on && moversFull)}
                    onChange={(v) => toggleMover(item.id, v)}
                  >
                    <span className={styles.box} aria-hidden>
                      <Check size={12} strokeWidth={3} />
                    </span>
                    <span className={styles.checkText}>
                      <span className={styles.checkLabel}>{item.name}</span>
                      {item.where && <span className={styles.checkHint}>{item.where}</span>}
                    </span>
                  </Checkbox>
                  {on && (
                    <TextInput
                      aria-label={`How ${item.name} moves`}
                      value={raw.moving.find((m) => m.id === item.id)?.how ?? ''}
                      onChange={(v) => setHow(item.id, v)}
                      maxLength={200}
                      placeholder="How it moves, e.g. ripples slowly"
                      disabled={locked}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {moversFull && (
          <Text tone="muted" size="sm" as="p" className={styles.line}>
            Up to {MAX_MOVING} things can move in one clip.
          </Text>
        )}
      </div>

      {resolved.people.present && (
        <div className={styles.group} role="group" aria-labelledby={`${uid}-people`}>
          <h3 id={`${uid}-people`} className={styles.groupTitle}>
            People
          </h3>
          <TextArea
            aria-label="What the people do"
            rows={2}
            value={raw.people.action}
            onChange={(v) => edit({ people: { ...raw.people, action: v.slice(0, 400) } })}
            placeholder="e.g. the woman by the railing turns her head toward the pool and holds"
            disabled={locked}
          />
          <Text tone="muted" size="sm" as="p" className={styles.line}>
            Only the people already in the picture, one small action each. No one arrives, leaves or talks.
          </Text>
        </div>
      )}

      <div className={styles.group} role="group" aria-labelledby={`${uid}-beats`}>
        <h3 id={`${uid}-beats`} className={styles.groupTitle}>
          Beats
        </h3>
        <Text tone="muted" size="sm" as="p" className={styles.line}>
          When each change happens, as a share of the {seconds} second clip.
        </Text>
        <ol className={styles.beats}>
          {raw.beats.map((b, i) => (
            <li key={i} className={styles.beat}>
              <div className={styles.beatHead}>
                <span className={styles.beatName} aria-hidden>
                  Beat {i + 1}
                </span>
                <div className={styles.beatTime}>
                  <NumberInput
                    label={`Beat ${i + 1} time (percent)`}
                    value={Math.round(b.at * 100)}
                    onChange={(n) => setBeat(i, { at: Math.min(100, Math.max(0, n)) / 100 })}
                    min={0}
                    max={100}
                    step={5}
                    unit="%"
                    disabled={locked}
                  />
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove beat ${i + 1}`}
                  className={styles.beatRemove}
                  disabled={locked || raw.beats.length <= MIN_BEATS}
                  onPress={() => removeBeat(i)}
                >
                  Remove
                </Button>
              </div>
              <TextInput
                aria-label={`Beat ${i + 1}`}
                value={b.what}
                onChange={(v) => setBeat(i, { what: v })}
                maxLength={200}
                placeholder="What changes"
                disabled={locked}
              />
            </li>
          ))}
        </ol>
        {raw.beats.filter((b) => b.what.trim()).length < MIN_BEATS && (
          <Text tone="muted" size="sm" as="p" className={styles.line}>
            With fewer than two beats, the shot opens on the photograph and settles at the end.
          </Text>
        )}
        {raw.beats.length < MAX_BEATS && (
          <div>
            <Button size="sm" variant="ghost" icon={<Plus size={14} />} disabled={locked} onPress={addBeat}>
              Add a beat
            </Button>
          </div>
        )}
      </div>

      <div className={styles.group} role="group" aria-labelledby={`${uid}-focus`}>
        <h3 id={`${uid}-focus`} className={styles.groupTitle}>
          Focus
        </h3>
        <div className={styles.pair}>
          <Select
            label="Focus starts on"
            options={focusOptions}
            value={focusStart}
            onChange={(id) => setFocus(id, focusEnd)}
            disabled={locked}
          />
          <Select
            label="Focus ends on"
            options={focusOptions}
            value={focusEnd}
            onChange={(id) => setFocus(focusStart, id)}
            disabled={locked}
          />
        </div>
        {(focusStart === NO_FOCUS) !== (focusEnd === NO_FOCUS) && (
          <Text tone="muted" size="sm" as="p" className={styles.line}>
            Choose both to pull focus from one to the other.
          </Text>
        )}
      </div>

      <div className={styles.group} role="group" aria-labelledby={`${uid}-end`}>
        <h3 id={`${uid}-end`} className={styles.groupTitle}>
          Ends on
        </h3>
        <TextInput
          aria-label="The frame the shot ends on"
          value={raw.end}
          onChange={(v) => edit({ end: v })}
          maxLength={300}
          placeholder="e.g. the pavilion, centred, the pool still"
          disabled={locked}
        />
      </div>

      {resolved.rationale && (
        <div className={styles.group} role="group" aria-labelledby={`${uid}-why`}>
          <h3 id={`${uid}-why`} className={styles.groupTitle}>
            Why
          </h3>
          <Text tone="muted" size="sm" as="p" className={styles.line}>
            {resolved.rationale}
          </Text>
        </div>
      )}
    </div>
  );
}

/** A new beat's place: the middle of the widest gap between the beats (and the clip's ends), to the nearest 5%. */
function nextBeatAt(beats: ShotPlanRaw['beats']): number {
  const points = [0, 1, ...beats.map((b) => b.at)].sort((a, b) => a - b);
  let at = 1;
  let widest = -1;
  for (let i = 1; i < points.length; i++) {
    const gap = points[i]! - points[i - 1]!;
    if (gap > widest) {
      widest = gap;
      at = (points[i]! + points[i - 1]!) / 2;
    }
  }
  return Math.round(at * 20) / 20;
}
