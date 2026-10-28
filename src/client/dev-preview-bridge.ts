import { connectPreviewBridge } from '@runway/bay-react/preview-bridge';

// Belt and braces with the plugin's `apply: 'serve'`. The bridge answers
// whichever frame asks, so shipped it would let any page that iframes this app
// read its text. Vite folds this to `false` in a build.
if (import.meta.env.DEV) {
  connectPreviewBridge();
}
