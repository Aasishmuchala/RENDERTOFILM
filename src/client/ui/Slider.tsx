import { Label, Slider as AriaSlider, SliderOutput, SliderThumb, SliderTrack } from 'react-aria-components';

import styles from './Slider.module.css';

export type SliderProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
  /** Called once the drag or key press ends, with the final value. */
  onChangeEnd?: ((value: number) => void) | undefined;
  min?: number | undefined;
  max?: number | undefined;
  step?: number | undefined;
  /** How the value reads beside the label ("+12", "80%"). */
  format?: ((value: number) => string) | undefined;
  disabled?: boolean | undefined;
};

/** A horizontal slider; arrow keys step it, Home and End jump to the ends. */
export function Slider({
  label,
  value,
  onChange,
  onChangeEnd,
  min = 0,
  max = 1,
  step = 0.01,
  format,
  disabled = false,
}: SliderProps) {
  return (
    <AriaSlider
      className={styles.slider}
      value={value}
      onChange={onChange}
      onChangeEnd={onChangeEnd}
      minValue={min}
      maxValue={max}
      step={step}
      isDisabled={disabled}
    >
      <div className={styles.head}>
        <Label className={styles.label}>{label}</Label>
        <SliderOutput className={styles.output}>
          {({ state }) => (format ? format(state.getThumbValue(0)) : state.getThumbValueLabel(0))}
        </SliderOutput>
      </div>
      <SliderTrack className={styles.track}>
        {({ state }) => (
          <>
            <span className={styles.rail} />
            <span
              className={styles.fill}
              style={{
                left: `${Math.min(state.getThumbPercent(0), (0 - min) / (max - min || 1)) * 100}%`,
                right: `${(1 - Math.max(state.getThumbPercent(0), (0 - min) / (max - min || 1))) * 100}%`,
              }}
            />
            <SliderThumb className={styles.thumb} />
          </>
        )}
      </SliderTrack>
    </AriaSlider>
  );
}
