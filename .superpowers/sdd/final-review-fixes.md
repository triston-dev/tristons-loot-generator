# Final-review fix wave — 2026-07-02

## Fix 1: missing i18n namespaces + unlocalized notification sites

Enumerated every `TLG.Intent.*`, `TLG.Finalize.*`, `TLG.Revert.*`, `TLG.SessionStore.*`
key referenced from `scripts/`:

- `TLG.Intent`: SessionNotReleased, UnknownAction, ItemNotFound, ActorNotInParty,
  ItemNotClaimable, ItemNotUnclaimable, ItemNotAbandonable, ItemNotRestorable,
  AllocationActorNotInParty, BadAllocation, AllocationMismatch, UnexpectedError
  (12 keys)
- `TLG.Finalize`: NotResolved, PartialFailure (2 keys)
- `TLG.Revert`: NotFinalized, NotMostRecent, MissingItems, Success (4 keys)
- `TLG.SessionStore`: UnknownSession, IllegalTransition (2 keys) — these are
  thrown as `Error(...)` messages inside `updateSession`/`releaseSession`.
  Audited every call site: none of them are caught and surfaced via
  `ui.notifications`/toast today (socket-service's `processIntent` catch
  block always toasts the FIXED `TLG.Intent.UnexpectedError` key by design,
  never `err.message`, to avoid leaking internal detail). Added English
  strings anyway for correctness/future-proofing and because they appear in
  console logs, but no call site needed localize() wrapping for these two.

Total keys added: **20** (all under new `TLG.Intent`, `TLG.Finalize`,
`TLG.Revert`, `TLG.SessionStore` namespaces in `lang/en.json`).

Call sites wrapped with `game.i18n.localize(...)` / `game.i18n.format(...)`:
- `scripts/core/finalizer.js`: 6 sites (`NotResolved`, `PartialFailure` with
  `{actors}`, `NotFinalized`, `NotMostRecent`, `MissingItems` with `{items}`,
  `Success`)
- `scripts/core/socket-service.js`: 2 sites — `emitToast`'s local-display
  branch (`ui.notifications.warn(game.i18n.localize(message))`) and the
  socket `"toast"` message handler in `initSocket()`. Both localize at the
  final display point so it doesn't matter whether the reason arrived via
  the local (trusted) path or crossed the wire; `localize()` returns the
  input unchanged if it isn't a recognized key, so this is safe for both
  keys and any accidental pre-localized string.

Total: **8 call sites** wrapped.

## Fix 2: progress bar width bug

`templates/distribution.hbs` used `style="width: {{resolved}}0%"` — string
concatenation, not math (`resolved=3` → literal `"30%"` regardless of total).

Fix: extracted a pure helper `computeProgressPct(resolved, total)` in
`scripts/apps/distribution.js` (guards `total === 0` → `0`, avoiding NaN),
wired into `_prepareContext` as `progressPct`, and changed the template to
`style="width: {{progressPct}}%"`.

Added a unit test file addition: `tests/distribution-pure.test.js` now
covers `computeProgressPct` — regression case (3/10 → 30%, not the buggy
30% coincidence — cross-checked against 3/4 → 75% and 1/3 → 33% where the
old bug and the fix diverge), the total===0 → 0 guard, and the 100% case.

## Fix 3: importData packId mismatch — RED/GREEN

**RED**: added a failing test first in `tests/table-store.test.js`
("import rejects a payload whose packId does not match the active pack") —
imports a payload with `packId: "sw5e"` while the active pack is `dnd5e`
(per test setup). Before the fix this test failed: the import silently
succeeded and validated the sw5e payload's overrides against the dnd5e
table universe, corrupting state under the wrong pack key.

**GREEN**: `scripts/core/table-store.js` `importData` now checks
`data.packId !== pack.id` (using the already-resolved `pack = getActivePack()`)
and throws `Error("TLG.TableStore.PackMismatch")` before any validation or
writes. Added `TLG.TableStore.PackMismatch` to the existing `TableStore`
namespace in `lang/en.json`. Confirmed the store is unchanged after a
rejected import (asserted via `exportData()` before/after equality and
`getEffectiveTable("type:humanoid").name` still being the pack default).

## Test summary

`npx vitest run` → **296/296 passed** (292 baseline + 1 table-store
pack-mismatch test + 3 distribution-pure computeProgressPct tests).

## Files touched

- `lang/en.json`
- `scripts/core/socket-service.js`
- `scripts/core/finalizer.js`
- `scripts/core/table-store.js`
- `scripts/apps/distribution.js`
- `templates/distribution.hbs`
- `tests/table-store.test.js`
- `tests/distribution-pure.test.js`
- `.superpowers/sdd/final-review-fixes.md` (this file)
