# tamer-plugin

Optional middleman for Tamer plugins: **pluginTamer** finds and imports **tamer.config** itself; lynx.config does not import it.

- **pluginTamer** searches the project root for `tamer.config.ts`, `tamer.config.mjs`, or `tamer.config.js`, and uses the first one found. If none is found, it discovers configs from **workspaces** (monorepo packages that export `./tamer.config`) and from **node_modules**, then merges them.
- **tamer.config** holds developer-determined defaults (plugin instances). You can put one in the project root or rely on packages that ship one (e.g. tamer-router exports `tamer-router/tamer.config`).
- **Override** by passing options: `pluginTamer({ tamerRouter: false })` to disable, or pass a plugin instance to replace a default.

No plugins are hardcoded; tamer.config and options supply all plugin instances.

**Rsbuild defaults:** `pluginTamer` sets `server.base` to `/${basename(Lynx package dir)}` so it matches Tamer’s dev server path (`/${folderName}`), unless you already set `server.base`. The Lynx directory is taken from **`tamer.config.json`** at the nearest ancestor (walk up from the Rsbuild root): `lynxProject` or `paths.lynxProject`, resolved relative to the Tamer project root—the same idea as Tamer’s host config. If no `tamer.config.json` or no `lynxProject`, it falls back to the basename of the Rsbuild project root. It also sets `output.assetPrefix` to `'auto'` when unset so asset URLs stay relative to the bundle (works with that base path and avoids Lynx toolchain issues with path-only `publicPath`).

**Inline assets:** `pluginTamer` adds an Rspack `asset/inline` rule for imports with `?inline`, so image/font imports such as `import logo from './logo.png?inline'` resolve to data URLs.

## Install

```bash
npm install @tamer4lynx/tamer-plugin
```

Install any Tamer plugins you use (e.g. `tamer-router`) in the app.

## Usage in lynx.config.ts

Do **not** import tamer.config in lynx.config. Use **pluginTamer()** so the plugin loads defaults from tamer.config internally; pass options only to override or disable:

```ts
import { defineConfig } from '@lynx-js/rspeedy'
import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin'
import { pluginTamer } from '@tamer4lynx/tamer-plugin'

export default defineConfig({
  plugins: [
    pluginTamer(),
    // or with overrides:
    // pluginTamer({ tamerRouter: false }),
    // pluginTamer({ tamerRouter: tamerRouterPlugin({ root: './src/app' }) }),
    pluginReactLynx(),
  ],
})
```

## tamer.config

**Local:** Put **tamer.config.ts** (or .mjs / .js) in the project root and export default **plugin instances**; pluginTamer will load it first. Search order: `tamer.config.ts` → `tamer.config.mjs` → `tamer.config.js`.

**From workspaces:** If no local tamer.config is found, pluginTamer finds the **workspace root** (first directory above cwd with a `package.json` that has a `workspaces` field). It then resolves each workspace package (from `workspaces` globs or arrays), and for any package whose `package.json` exports **`./tamer.config`**, loads that file by path and merges it.

**From node_modules:** It also scans **node_modules** for packages that export **`./tamer.config`**, loads each via `import('pkg-name/tamer.config')`, and merges (workspace configs first, then node_modules, alphabetically by name). So packages like tamer-router are discovered whether they are workspace packages or installed dependencies.

## Options

- **`pluginTamer()`** – use all defaults from tamer.config (if found).
- **`pluginTamer({ pluginName: false })`** – do not add this plugin.
- **`pluginTamer({ pluginName: somePlugin() })`** – use this instance instead of the default.
