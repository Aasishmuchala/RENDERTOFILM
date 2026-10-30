# New App

_No description in bay.yaml yet._

## What this app does

<!-- Keep this section current: what a user can do with the app. -->

<!-- bay:app-map:start -->

## App map

_Generated after every turn — do not hand-edit._

- **Name:** render-to-film
- **Title:** Render to Film
- **Description:** Turn a 3D architectural or landscape render into a photorealistic, cinematic film still in a chosen light.
- **Type:** app

### Features

- `storage` — S3 file storage
- `webapp-runway-api` — Runway-API app starter (webapp + SDK + Runway auth, pre-wired, polished UI)
- `runway-api` — Runway API authentication (cookie-based session; works without the SDK)
- `bay-sdk` — TypeScript SDK (@runway/bay) — typed clients and middleware for App Studio/Runway

Per-feature env vars and usage are in `.bay/docs.md`.

### Entrypoint and scripts

- **script `dev`:** `bay dev`
- **script `start`:** `tsx src/index.ts`
- **script `build`:** `tsc --noEmit && vite build && node -e "require('esbuild').build({entryPoints:['src/index.ts'],bundle:true,platform:'node',packages:'external',keepNames:true,ignoreAnnotations:true,target:'node'+process.versions.node,format:'esm',sourcemap:true,logLevel:'warning',outfile:'.build/index.mjs'}).catch(()=>process.exit(1))"`
- **script `typecheck`:** `tsc --noEmit`
- **Dockerfile:** present

### Dependencies

- `@aws-sdk/client-s3` 3.1018.0
- `@aws-sdk/s3-request-presigner` 3.1018.0
- `@koa/router` ^15.5.0
- `@runway/bay` 23.55.2
- `@runway/bay-react` 0.23.2
- `@tanstack/react-query` ^5.100.10
- `@trpc/client` ^11.17.0
- `@trpc/react-query` ^11.17.0
- `@trpc/server` ^11.17.0
- `koa` ^3.2.0
- `koa-static` ^5.0.0
- `lucide-react` 1.28.0
- `react` ^19.2.6
- `react-aria-components` 1.22.1
- `react-dom` ^19.2.6
- `sharp` ^0.34.5
- `zod` ^4.4.3

### Files

```
.build/
  index.mjs
  index.mjs.map
public/
  sample-render.jpg
src/
  client/
    director/
    layouts/
    lib/
    styles/
    ui/
    App.module.css
    App.tsx
    CastSheetField.tsx
    CloseupsPage.module.css
    CloseupsPage.tsx
    DeleteItemDialog.tsx
    dev-error-panel.ts
    dev-preview-bridge.ts
    DirectorPage.module.css
    DirectorPage.tsx
    EditPage.module.css
    EditPage.tsx
    LibraryPage.module.css
    LibraryPage.tsx
    LightReferenceField.tsx
    LocationPage.module.css
    LocationPage.tsx
    main.tsx
    PeopleCheck.module.css
    PeopleCheck.tsx
    StillsPage.tsx
    Studio.module.css
    trpc.ts
    trpcLink.ts
    UpscaleClip.tsx
    UpscaleStill.tsx
    VideoFrames.tsx
    VideoPage.tsx
  dev/
    error-panel-plugin.ts
    parse-imports.ts
    pending-imports-plugin.ts
    preview-bridge-plugin.ts
    preview-console-plugin.ts
  vendor/
    trpc-koa-adapter.ts
  api-body.ts
  api-routes.ts
  api.ts
  checks.ts
  closeups-api.ts
  colour.ts
  composite.ts
  edit-api.ts
  editor.ts
  edits.ts
  grades.ts
  imaging.ts
  index.ts
  library.ts
  location-api.ts
  location.ts
  looks.ts
  media.ts
  models.ts
  profile.ts
  routes.ts
  still-submit.ts
  storage.ts
  storyboard-api.ts
  storyboard.ts
  surroundings.ts
  tags.ts
  task-helpers.ts
  thumbs.ts
  timeline.ts
  trpc.ts
  vite-env.d.ts
.dockerignore
.gitignore
.npmrc
.secretlintrc.json
AGENTS.md
bay.models.json
bay.yaml
DESIGN.md
Dockerfile
index.html
lefthook.yml
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
tsconfig.json
vite.config.ts
```

<!-- bay:app-map:end -->
