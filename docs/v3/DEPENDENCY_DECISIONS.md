# MAJIN V3 dependency decisions

**Round:** initial vertical slice · 2026-10-22.

## Added in V3

**None.** V3 uses Node built-ins (`fs`, `path`, `crypto`, `http`) and internal V2 modules (`Goal`, `runVerifier`). The browser client uses native `fetch`. No package manifest or lockfile change is required for this slice.

| Requirement | Reused component | Why it is sufficient now | License / notice |
|---|---|---|---|
| Goal state and durable receipts | `src/v2/runtime/goal.js` and `receipts.js` | Already provides legal transitions, acceptance gates and persistence. | Internal MAJIN project code; no third-party license change. |
| File verification | `src/v2/runtime/verifiers.js` | Independent file existence/size/hash verification already exists. | Internal MAJIN project code. |
| Safe local HTTP UI | Node `http`, `URL`, browser `fetch` | Loopback-only route and simple JSON request need no web framework. | Node.js runtime terms. |
| Browser E2E (future) | Existing `playwright` devDependency | Do not add another automation framework; V3 browser-rendered acceptance is not yet implemented. | Apache-2.0; preserve dependency notices in release metadata. |

## Reviewed, not adopted

- **Browser Use:** MIT; Python runtime and separate AI browser loop would overlap MAJIN's existing browser and goal code.
- **LiveKit Agents:** Apache-2.0 framework; voice plugins/model assets can carry distinct terms; Python/WebRTC architecture needs a real Windows evaluation.
- **Pipecat:** BSD-2-Clause; strong realtime pipelines but additional Python/service packaging needs justification.
- **Silero VAD:** MIT candidate; model/runtime selection, Windows packaging, Swedish and noise performance are not yet validated.
- **LangGraph:** MIT; V2 already provides a native goal/DAG/scheduler layer.
- **OpenHands:** MIT core; WSL/Docker-oriented Windows deployment adds a substantial optional-runtime cost.
- **Mem0:** Apache-2.0; vector/embedding infrastructure is not justified by a current measured requirement.

Details and source links: [`UPSTREAM_RESEARCH.md`](./UPSTREAM_RESEARCH.md).

## Runtime compatibility blocker

The repository declares Node `>=20.11.0`, while `npm ci` on Node `20.20.2` reported engine requirements `>=22` for several installed packages (including `canonicalize`, `p-queue`, and transitive packages). The current tests pass on Node 20 but this is not proof of supported runtime compatibility. Before a V3 release, either:

1. raise the supported runtime/install requirement to Node 22 and validate Windows packaging, or
2. select compatible dependency versions and rerun the full test, security and packaging suites on Node 20.

Do not silently change the engine floor without updating the installer, docs, CI and clean-install tests.
