# Building `majin-win-x64.exe`

MAJIN ships as a single-file Windows executable so nobody has to install Node to run an agent.
The recipe is `esbuild` (bundle to one CommonJS file, no minification) +
[`@yao-pkg/pkg`](https://github.com/yao-pkg/pkg) (that bundle + a Node host = an `.exe`).

```bash
npm ci
npm run exe          # → dist/majin-win-x64.exe  (host-matching node target, win-x64)
npm run exe:all      # win-x64 + linux-x64 + macos-arm64
npm run exe:bundle   # only dist/majin.cjs — the step that needs no network
PKG_TARGET=node22-win-x64 npm run exe   # pin a specific pkg target
```

The result is self-contained: `dist/` gets the exe **plus** `ui/`, `rules/` and `assets/`
next to it (pkg embeds them as snapshots too, but the copies make the folder browsable and let
you drop in your own `.yar` files). The bundled input (`dist/majin.cjs`) is verified here in the same way —
it finds the copied UI, the seeded rules and its own port with no `node_modules` in
sight — and the Windows run repeats it on the exe.

## Why the path code looks the way it does

A pkg snapshot has no real filesystem layout, so anything computed from `import.meta.url`/
`__dirname` has to survive two worlds:

* `src/core/paths.js` — `SELF_DIR` is `path.dirname(process.execPath)` when `process.pkg` is set;
  `repoRoot` collapses to the exe's own directory, and `pkgRules` points at the snapshot's
  `rules/` for first-run seeding.
* `src/core/server/index.js` — `UI_CANDIDATES` tries `SELF_DIR/ui`, `../../ui`,
  `<execDir>/ui` and `cwd/src/ui`; the first one containing `index.html` wins.
* `src/cli/majin.js` — `majin start` respawns the server child: under pkg it re-executes
  `process.execPath` with `_serve`, otherwise it looks for `majin.js`/`.cjs`/`.mjs` next to
  itself. `esbuild`'s `format:'cjs'` output is used precisely because `require`-based code can
  read `__dirname` safely.

If you add a file the app must read at runtime, put it in `assets`/`rules`/`ui` in
`scripts/build-exe.mjs` — the bundler's `pkg.assets` list is the single place that decides what
goes into the snapshot.

## Why CI builds it, not your laptop (or this sandbox)

`pkg` does not compile Node: it downloads a **prebuilt Node host** per target
(`node22-win-x64` …) from the `pkg-fetch` release assets, and those live behind
`release-assets.githubusercontent.com`. Any environment that can reach `github.com` but not that
host — restricted egress, a proxy, this sandbox — fails with

```
Not able to build for 'win' here, only for 'linux'
```

because pkg falls back to *building the host from source*, which needs a Windows cross-toolchain.
The fix is to build where the download works, which is what
[`.github/workflows/build-exe.yml`](../.github/workflows/build-exe.yml) does: `windows-latest`,
Node 22, `npm ci`, bundle, package, then a smoke test that runs the artifact itself
(`version`, `doctor`) and uploads it as a build artifact. Push a `v*` tag and the same workflow
attaches the exe to a GitHub release.

Two details that cost time if you get them wrong:

* **The target must exist as a published host.** `pkg` only prebuilds the Node versions it has
  published; asking for `node20-win-x64` when only 22.x/24.x/26.x exist sends you down the
  build-from-source path. `scripts/build-exe.mjs` therefore defaults to
  `node<major-of-the-host-node>-win-x64`.
* **Do not minify.** The bundling step keeps names and formatting (`minify: false`) so stack
  traces and the model's own `majin doctor` output stay readable; the win is a 0.5 MB bundle,
  the exe is ~50 MB either way.

## Verifying the bundle without a Windows box

```bash
npm run exe:bundle
MAJIN_HOME=/tmp/majin-check node dist/majin.cjs doctor
MAJIN_HOME=/tmp/majin-check node dist/majin.cjs serve --no-browser --port 8941 &
curl -s localhost:8941/healthz
```

`majin.cjs` is the exact input to pkg — same bundle, same snapshot-relative lookups — so a green
`doctor` there means the packaging is a formality. It does **not** prove the PE header, the icon
or Task Scheduler behaviour; only a Windows run does that.

## Antivirus and SmartScreen

A packed Node binary that opens a listening port is exactly the profile heuristics flag. If that
matters to you: sign with your own certificate (`pkg --options` + `signtool`), publish the SHA-256
next to the artifact, or use the repo install (`install.ps1`) which runs through `node.exe`.
