import { useMemo } from 'react';

import { ANGLES, type AngleId, CROWDS, type CrowdId, LOOKS, type LookId } from '../../looks.ts';
import type { FrameChoice, FramePlan } from '../../storyboard-api.ts';
import { Select } from '../ui/Select.tsx';
import { Text } from '../ui/Text.tsx';
import { TextInput } from '../ui/TextInput.tsx';
import own from '../DirectorPage.module.css';
import { withPick } from './shared.ts';

const NOTE_MAX = 400;

export type FrameControlsProps = {
  frame: FramePlan;
  choice: FrameChoice | undefined;
  disabled: boolean;
  onChoose: (image: number, patch: FrameChoice) => void;
  onShoot: (image: number) => void;
};

/** One frame's light, camera, people and direction, the planner's pick first in each. */
export function FrameControls({ frame, choice, disabled, onChoose, onShoot }: FrameControlsProps) {
  const look = choice?.look ?? frame.look;
  // Like Stills: the image's own camera unless a move is picked.
  const angle = choice?.angle ?? 'as-rendered';
  const crowd = choice?.crowd ?? frame.crowd;
  const note = choice?.note ?? '';
  const lookOptions = useMemo(() => withPick(LOOKS, frame.look, frame.lookWhy, 'All lighting'), [frame.look, frame.lookWhy]);
  const crowdOptions = useMemo(() => withPick(CROWDS, frame.crowd, frame.crowdWhy, 'All people'), [frame.crowd, frame.crowdWhy]);
  return (
    <div className={own.options}>
      <Select label="Lighting" options={lookOptions} value={look} onChange={(id) => onChoose(frame.image, { look: id as LookId })} disabled={disabled} />
      <Select label="Camera" options={ANGLES} value={angle} onChange={(id) => onChoose(frame.image, { angle: id as AngleId })} disabled={disabled} />
      <Select label="People" options={crowdOptions} value={crowd} onChange={(id) => onChoose(frame.image, { crowd: id as CrowdId })} disabled={disabled} />
      {crowd !== 'none' && crowd === frame.crowd && frame.people && (
        <Text tone="muted" size="sm" as="p">
          Who: {frame.people}. Always real, photographed people.
        </Text>
      )}
      <TextInput
        label="Direction (optional)"
        value={note}
        onChange={(v) => onChoose(frame.image, { note: v })}
        maxLength={NOTE_MAX}
        disabled={disabled}
        placeholder="e.g. keep the pool empty, a softer sky"
        onPressEnter={() => onShoot(frame.image)}
      />
    </div>
  );
}
