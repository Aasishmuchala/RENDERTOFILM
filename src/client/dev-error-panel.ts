const CONTAINER_ID = 'bay-dev-error-panel';

type ViteError = { message?: string; id?: string };

function styleText(el: HTMLElement, css: Record<string, string>): void {
  for (const [key, value] of Object.entries(css)) {
    el.style.setProperty(key, value);
  }
}

function hide(): void {
  document.getElementById(CONTAINER_ID)?.remove();
}

function show(err: ViteError): void {
  hide();

  const container = document.createElement('div');
  container.id = CONTAINER_ID;
  styleText(container, {
    position: 'fixed',
    'z-index': '2147483647',
    left: '16px',
    right: '16px',
    bottom: '16px',
    margin: '0 auto',
    'max-width': '640px',
    padding: '14px 16px',
    'border-radius': '10px',
    border: '1px solid rgba(127,127,127,0.28)',
    background: 'var(--bay-bg-canvas, #ffffff)',
    color: 'var(--bay-text, #0a0a0b)',
    'font-family': 'var(--bay-font-sans, system-ui, sans-serif)',
    'font-size': '13px',
    'line-height': '1.55',
    'box-shadow': '0 8px 30px rgba(0,0,0,0.16)',
  });

  const heading = document.createElement('div');
  heading.textContent = 'This part is still being built';
  styleText(heading, { 'font-weight': '600' });

  const body = document.createElement('div');
  body.textContent =
    'The app stopped updating because of an error in the code. It should pick up again on its own once the change lands.';
  styleText(body, {
    'margin-top': '2px',
    color: 'var(--bay-text-3, #71717a)',
  });

  const details = document.createElement('details');
  styleText(details, { 'margin-top': '8px' });

  const summary = document.createElement('summary');
  summary.textContent = 'Show details';
  styleText(summary, {
    cursor: 'pointer',
    color: 'var(--bay-text-3, #71717a)',
    'font-size': '12px',
  });

  const pre = document.createElement('pre');
  pre.textContent = [err.id, err.message ?? 'Unknown error']
    .filter(Boolean)
    .join('\n\n');
  styleText(pre, {
    margin: '8px 0 0',
    'max-height': '200px',
    overflow: 'auto',
    'white-space': 'pre-wrap',
    'word-break': 'break-word',
    'font-size': '12px',
    color: 'var(--bay-text-3, #71717a)',
  });

  details.append(summary, pre);
  container.append(heading, body, details);
  document.body.append(container);
}

if (import.meta.hot) {
  import.meta.hot.on('vite:error', (payload: { err?: ViteError }) => {
    show(payload?.err ?? {});
  });
  // Any successful update means the error is stale, whatever it was.
  import.meta.hot.on('vite:afterUpdate', hide);
  import.meta.hot.on('vite:beforeFullReload', hide);
}
