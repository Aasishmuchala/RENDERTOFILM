import { SkeletonBlock } from './Skeleton.tsx';

export function PendingBlock({ height = 120 }: { height?: number | string }) {
  return (
    <div data-bay-block="pending" style={{ width: '100%' }}>
      <SkeletonBlock height={height} />
    </div>
  );
}
