# Web review

## Final review

Reviewed the current storage, import/export, scenario freshness, and run snapshot source. No remaining major source blocker found in the reviewed workflows. Destructive import/restore/start-fresh operations pause autosave and serialize snapshot/save transitions; import validation preserves rejected JSON for inspection; persistence validates and backs up raw rows; scenario and projection run records surface stale state; comparisons use stored run snapshots.

## Browser smoke

Date: 2026-11-10. Local Vite app at `http://127.0.0.1:5173/` in Safari.

- Fresh launch reached the sample plan and showed local-save status.
- Ran the sample scenario; it showed Success, final net worth, and a run timestamp.
- Projection view displayed charts and the age-by-age table through age 95.
- Compare view accepted two saved runs and rendered a side-by-side table and net-worth comparison chart.
- Reload returned to the persisted sample workspace.

Profile fractional-age edit was tried as a transient input; navigating away reset it to the stored age. JSON import/export was not exercised in the browser smoke. Browser automation was through Safari because the browser tab service was unavailable.

## Current responsive verification — passed

Date: 2026-11-10. The final current app at `http://127.0.0.1:5173/` was measured in
project-local Playwright Chromium Headless Shell 158, device scale factor 2. This
verification supersedes the earlier port 5174 responsive report below. No root
overflow was hidden to obtain these results.

| CSS viewport width | Plan client / page width | Projection client / page width | Uncontained overflowing elements |
| --- | --- | --- | --- |
| 320 | 320 / 320 | 320 / 320 | 0 |
| 375 | 375 / 375 | 375 / 375 | 0 |
| 768 | 768 / 768 | 768 / 768 | 0 |
| 1280 | 1280 / 1280 | 1280 / 1280 | 0 |

All five main navigation labels fit within the viewport, wrapping into two rows
at mobile widths. All six Plan section tabs also wrap on mobile. The sample-plan
card, Export JSON control, native file picker, profile fields, and save/run buttons
fit at 320 and 375 pixels. Every chart's SVG stays inside its card. The audit table
retains its deliberate local horizontal scroll (2,117 pixels of table content in
a viewport-bounded container).

Measurements and eight screenshots were generated under the ignored `.uiqa/`
directory; the 320-pixel Plan screenshot was visually inspected after the final
tab change. The app has no Playwright runtime dependency. Final checks: 165 web
tests passed, production build and web typecheck passed; the unchanged engine
suite previously passed 187 tests. Base-return inputs also remove binary display
noise while preserving the exact stored value on an untouched save.

## Earlier Safari responsive and workflow review (superseded)

Date: 2026-11-10. Safari Responsive Design Mode, 320, 375, 768, and 1280 CSS-pixel widths; local app at `127.0.0.1:5174` for this pass.

- Confirmed Current age is read-only and derived from birth year (1980 showed age 46 in 2026). The earlier test changed the birth year, displayed an unsaved-profile message, disabled Run projection, then showed “Profile changes applied.” on Save profile and “Saved on this device” after persistence. The sample on port 5173 showed the original 1981 / age 45 profile after switching servers.
- Ran projection from Plan; it routed to Projection, focused the “Year-by-year projection results” container, and displayed the selected “Base scenario” result. The first table row matched age 46 / year 2026.
- Responsive blocker observed at 320 and 375: the page shows a horizontal scrollbar, and the Plan screen clips the Export JSON button and file input/status text beyond the right edge. In the main navigation, only Plan, Projection, and Assumptions were visible; Scenarios and Compare were not visible although the accessibility tree exposed all five controls. At 768 all five navigation labels appeared over three rows. 1280 was also inspected; the full-width layout was visible.
- Safari’s browser-tab host was unavailable, so I could not read DOM `clientWidth`/`scrollWidth`. The port 5174 responsive screenshots were captured during HMR; the later attempt to switch to 5173 changed Safari’s active window, so the final 5173 mobile layout was not verified. JSON import/export was not exercised in this pass.
