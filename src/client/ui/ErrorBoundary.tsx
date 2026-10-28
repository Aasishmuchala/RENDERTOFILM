import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';

import { Button } from './Button.tsx';
import styles from './ErrorBoundary.module.css';

type Props = {
  children: ReactNode;
  /** Names the region in the fallback copy, e.g. "chart". */
  label?: string;
};

type State = { error: Error | null };

/** Wrap each route and section, not just the root — a single top-level
 * boundary turns one broken component into an empty page. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  // Without this the boundary stays tripped after the fix lands and reads as
  // a second bug.
  override componentDidMount(): void {
    import.meta.hot?.on('vite:afterUpdate', this.reset);
  }

  override componentWillUnmount(): void {
    import.meta.hot?.off('vite:afterUpdate', this.reset);
  }

  private reset = (): void => {
    if (this.state.error) this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <ErrorView error={error} label={this.props.label} onRetry={this.reset} />
    );
  }
}

function ErrorView({
  error,
  label,
  onRetry,
}: {
  error: Error;
  label: string | undefined;
  onRetry: () => void;
}) {
  return (
    <div data-bay-block="error" className={styles.error}>
      <div className={styles.title}>
        {label ? `The ${label} didn't load` : "This part didn't load"}
      </div>
      <details className={styles.details}>
        <summary className={styles.summary}>Show details</summary>
        <pre className={styles.pre}>
          {error.name}: {error.message}
        </pre>
      </details>
      <Button size="sm" onPress={onRetry}>
        Try again
      </Button>
    </div>
  );
}
