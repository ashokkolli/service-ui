# FASTBREAK Design Tokens — token overlay for the ReportPortal fork

Status: **proposed**. Nothing in this document has been applied.
Owner: Staff Designer, FASTBREAK.
Scope reality: the fork has 2,367 jsx/js and 662 scss files. We do **not** reskin it. We override
the SCSS variables that `sass-resources-loader` already injects into every one of those 662 files,
plus ~14 shared primitives. Everything else inherits.

---

## 0. Why this works — the one build fact that makes a token overlay viable

`app/webpack/prod.config.js:55-60` (and `dev.config.js:60-65`) run every `.scss` through:

```js
{ loader: 'sass-resources-loader',
  options: { resources: path.resolve(__dirname, '../src/common/css/variables/**/*.scss') } }
```

Every partial under `app/src/common/css/variables/` is prepended to **all 662 stylesheets**.
So editing 6 variable files re-colours, re-types and re-spaces the whole product, with zero
change to component markup and near-zero upstream merge surface.

The files that are the token surface — all verified present:

| File | Today | Becomes |
|---|---|---|
| `app/src/common/css/variables/colors.scss` | 85 ad-hoc `$COLOR--*` | remapped to the ramp below |
| `app/src/common/css/variables/newColors.scss` | 55 more `$COLOR--*` | remapped |
| `app/src/common/css/variables/font-variable.scss` | 10 `$FONT-*` webfont families | system stack + new `$FS-*` / `$LH-*` |
| `app/src/common/css/variables/boxShadows.scss` | 3 `$BOX_SHADOW--*` | 2 elevation steps |
| *(new)* `app/src/common/css/variables/space.scss` | — | `$SP-*`, `$RADIUS`, `$BORDER-*`, `$ROW-H` |
| `app/src/common/css/common.scss` | `body` bg/font | canvas + base type + global `:focus-visible` |

> Do **not** invent a parallel `--fb-*` system inside `app/src`. One already exists in the deployed
> overlay (`fastbreak-platform/deploy/rp/service-ui/assets/brand.css`) and a second one would give us
> three competing sources of truth. See §6 for how the two reconcile.

---

## 1. Type scale

**Font stack.** RP ships and self-hosts OpenSans + Roboto (`app/src/common/css/fonts/`, 10 families
via `$FONT-REGULAR`, `$FONT-SEMIBOLD`, `$FONT-CONDBOLD`…). Drop the webfonts; adopt the system stack
already chosen by the shipped brand layer so we do not fork the decision:

```scss
$FONT-UI:    -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, 'Helvetica Neue', Arial, sans-serif;
$FONT-MONO:  ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, Consolas, 'Roboto Mono', monospace;
```

*Reasoning:* system fonts render at the OS's own hinting and weight, which is most of the perceived
gap between RP and Jira. It also deletes ~1.2 MB of webfont payload and the `OpenSansCondBold`
all-caps look, which is the single most "1990s" signal in the current UI.
Keep `$FONT-MONO` for `stackTrace__`, `logMessageBlock__`, `markdownViewer__` — log content must stay
monospaced or stack traces stop being scannable.

**Scale.** Base **14px**, ratio **1.125** (major second), rounded to whole px, every line-height a
multiple of 4 so type never breaks the 8px rhythm.

| Token | Size / line-height | Weight | Use |
|---|---|---|---|
| `$FS-100` | 11 / 16 | 600 | column-header eyebrow, chip label, meta |
| `$FS-200` | 12 / 16 | 400 | secondary text, timestamps, helper text |
| `$FS-300` | **14 / 20** | 400 | **base** — body, table cell, input, button |
| `$FS-400` | 16 / 24 | 600 | section heading, emphasised value |
| `$FS-500` | 20 / 28 | 600 | page title |
| `$FS-600` | 24 / 32 | 600 | KPI numeral |
| `$FS-700` | 30 / 36 | 700 | hero KPI (rare) |

**Collapse map.** RP currently uses **20 distinct px sizes** (measured across all `.scss`):
13px ×346, 12px ×177, 14px ×55, 11px ×50, 16px ×39, 15px ×33, 10px ×31, 20px ×14, 24px ×9, 17px ×9,
9px ×7, 18px ×6, 22px ×5, 19px ×4, 7/8/29/32/36/39px. Twenty sizes is not a scale; it is an accident.

| RP sizes | collapse into |
|---|---|
| 7, 8, 9, 10, 11 | `$FS-100` (11) |
| 12 | `$FS-200` (12) |
| **13, 14, 15** | `$FS-300` (14) — **434 declarations, the bulk of the product** |
| 16, 17, 18, 19 | `$FS-400` (16) |
| 20, 22 | `$FS-500` (20) |
| 24, 29 | `$FS-600` (24) |
| 32, 36, 39 | `$FS-700` (30) |

The 13→14 move alone is what makes the grid readable; 13px OpenSans is the fork's default body size
and it is a size no modern product UI uses.

---

## 2. Spacing — 8px rhythm

RP is on a **5px rhythm** (`padding: 10px` ×59, `5px` ×40, `15px` ×36, `20px` ×23) with 4/6/7/9/12/16
scattered through. A 5px rhythm cannot align to 8px icons, 16px avatars or 24px line-heights, which
is why RP's rows read as slightly-off everywhere.

| Token | px | Used for |
|---|---|---|
| `$SP-1` | 4 | icon↔label gap, chip vertical padding, stripe width |
| `$SP-2` | 8 | chip horizontal padding, tight stack, inline control gap |
| `$SP-3` | 12 | **table cell vertical padding**, input vertical padding |
| `$SP-4` | 16 | **table cell horizontal padding**, card padding, control gap |
| `$SP-5` | 24 | section gap, card padding (large), page gutter |
| `$SP-6` | 32 | major section separation |
| `$SP-7` | 48 | page top/bottom margin |

Migration: RP `5→4`, `10→8`, `15→16`, `20→24` (section gaps) / `20→16` (first-cell padding).

---

## 3. Colour — neutrals ramp + semantic-only accent

### 3.1 The rule

**Colour is reserved for STATUS.** Accent blue is permitted in exactly four places: link text,
primary button fill, focus ring, active-nav indicator. Nowhere else. Every other surface, border,
divider, header, icon and chrome element is a neutral.

This is not stylistic. It is why status currently reads as noise: the fork paints its accent
decoratively across the log slider, sidebar outlines and table chrome, so a red FAILED count has to
compete with blue that means nothing.

### 3.2 Neutrals

Slate-tinted (hue ≈ 220) so neutrals sit under the accent rather than fighting it.

| Token | Hex | Role | Contrast |
|---|---|---|---|
| `$N-0` | `#ffffff` | surface, table row | — |
| `$N-25` | `#fafbfc` | page canvas | — |
| `$N-50` | `#f4f5f7` | column-header fill, zebra, hover |  — |
| `$N-100` | `#e8eaee` | **hairline divider** (decorative) | 1.20:1 vs `$N-0` |
| `$N-200` | `#d5d9e0` | subtle edge (decorative) | 1.42:1 vs `$N-0` |
| `$N-450` | `#7e8899` | **control border** (input, checkbox, select) | **3.58:1** vs `$N-0`, **3.45:1** vs `$N-25`, **3.28:1** vs `$N-50` — passes 1.4.11 on every surface |
| `$N-400` | `#8993a4` | icon-only / no-data stripe | 3.10:1 vs `$N-0` (non-text only) |
| `$N-500` | `#626f86` | secondary text, **placeholder** | **5.08:1** vs `$N-0`; 4.65:1 vs `$N-50` |
| `$N-600` | `#44546f` | column-header label, strong secondary | **7.65:1** vs `$N-0`; **7.02:1** vs `$N-50` |
| `$N-800` | `#172b4d` | **primary text** | **14.10:1** vs `$N-0`; 12.93:1 vs `$N-50`; 13.61:1 vs `$N-25` |
| `$N-RAIL` | `#16233a` | sidebar rail | see §3.5 |

Two honest constraints, stated rather than hidden:

- `$N-100` (1.20:1) and `$N-200` (1.42:1) **do not meet 3:1** and are therefore **decorative dividers
  only** — permitted between table rows, where the content itself conveys structure (WCAG 1.4.11
  applies to boundaries *required to identify a control*). Any border that identifies a control must
  use `$N-450`.
- `$N-400` (3.10:1) is **never text**. Placeholder text uses `$N-500`, not a light grey — placeholders
  are not exempt from 1.4.3.

### 3.3 Accent — interaction only

| Token | Hex | Contrast |
|---|---|---|
| `$ACCENT` | `#2f6fed` | **4.55:1** on `$N-0` (text AA); 4.39:1 on `$N-25` (ring, needs 3:1) |
| `$ACCENT-PRESSED` | `#295fd0` | **5.77:1** on `$N-0` |
| `$ACCENT-ON` | `#ffffff` | **4.55:1** on `$ACCENT`; 5.77:1 on `$ACCENT-PRESSED` |

`#2f6fed` clears AA at 4.55:1 with 0.05 of headroom. Do not lighten it. If a lighter blue is ever
wanted for a fill, the text on it must go dark, not stay white.

### 3.4 Semantic status

All values are AA as text on `$N-0`, and all clear 3:1 as a stripe.

| Status | Text/stripe | on white | Chip fill | Chip text on fill |
|---|---|---|---|---|
| Passed | `#1f7a4d` | **5.32:1** | `#e6f4ec` | **4.69:1** |
| Failed / Product bug | `#c8352b` | **5.25:1** | `#fcebe9` | **4.55:1** |
| Warning / Automation bug | `#8a6100` | **5.54:1** | `#fbf1dc` | **4.94:1** |
| System issue | `#5a4bd0` | **6.26:1** | `#ecebfb` | **5.32:1** |
| To investigate | `#a54800` | **5.95:1** | `#fdeee2` | **5.25:1** |
| Skipped / No defect | `#626f86` | **5.08:1** | `#eef0f3` | **6.70:1** |
| **No data** | `$N-400` `#8993a4` | 3.10:1 (stripe only) | *none* — see below | — |

Solid badges: `#ffffff` on `#c8352b` = **5.25:1**; on `#1f7a4d` = **5.32:1**. Both AA.

**`no_data` is not a status colour.** It gets no fill, no numeral and no green. It renders as an
em-dash `—` in `$N-400` with the label "no data", so an absent measurement can never be mistaken for
a zero or a pass. This is a design invariant, not a backend concern.

Every RP status colour it replaces fails AA as text today, which is why they had to move:
`$COLOR--passed #56b985` = **2.42:1**, `$COLOR--failed #f65e5e` = **3.14:1**,
`$COLOR--to-investigate #ffb743` = **1.73:1**, `$COLOR--topaz #1a9cb0` = **3.27:1**,
`$COLOR--gray-47 #777777` (the launches-grid column-header label) = **4.48:1** on white and
**4.15:1** on its actual `$COLOR--primary-gray` fill — a real, shipped AA failure in RP itself,
independent of any branding.

**Decision that needs confirming:** SYSTEM ISSUE moves from RP's blue `#0274d1` to violet `#5a4bd0`,
because a status that shares a hue with the interactive accent is not a status. Measured honestly,
`#5a4bd0` vs `#2f6fed` is only **1.38:1** — for a deuteranope those two are the same colour. Hue
alone therefore cannot carry it, which is why every defect cell **must** also carry a two-letter glyph
(PB / AB / SI / ND / TI) and a 4px stripe. Meaning is never by colour alone.

### 3.5 Sidebar rail — `#16233a`

| Foreground | Role | Contrast |
|---|---|---|
| `#c3cad6` | resting nav label + icon | **9.54:1** |
| `#ffffff` | active / hover | **15.72:1** |
| `#8e9bb0` | muted / section label | **5.59:1** |
| `#6f9dff` | active indicator bar, focus ring | **5.95:1** |

### 3.6 What must STOP being blue

| Element | Today | Change to |
|---|---|---|
| Log-level slider container | solid accent fill | transparent; only the *track* + *handle* are accent |
| Sidebar nav-link resting border | 2px accent border on every item | **no border**; accent only on the 2px active indicator and the focus ring |
| History header cell | 3px accent border on every cell | 1px `$N-100` bottom rule only; accent only on the genuinely `.highlighted` cell |
| History item | 2px accent border on every selectable row | border only on `.selected` |
| Launches/defect column cells | accent + accent-dark fills | `$N-0`; the defect *type* is a 4px stripe + glyph |
| Statistics-total / statistics-col | accent fill | `$N-0`, numeral in `$N-800` |
| `componentHealthCheckTable` defect + statistics cols | accent fills | same as above |
| Grid chrome, table borders, tab underlines, scrollbars | accent | `$N-100` / `$N-450` |

---

## 4. Density

Jira and BrowserStack read as modern mostly through generous row height and restrained dividers,
not through colour. This section is the highest-leverage part of the overlay.

| Token | Value | Note |
|---|---|---|
| `$ROW-H` | **48px** | `$SP-3` 12 + line-height 24 + `$SP-3` 12 = 48 exactly, on-grid |
| `$ROW-H-HEADER` | **40px** | `$SP-3` 12 + 16 + `$SP-3` 12 |
| cell padding | `$SP-3 $SP-4` → **12px 16px** | first cell `padding-left: $SP-5` (24) |
| cell line-height | **24px** | at `$FS-300`; the generous leading *is* the modern feel |
| cell vertical-align | **middle** | RP uses `top` (`gridCell.scss:35`) while the header uses `middle` — that mismatch is why the first data row looks detached from its header |
| `$RADIUS` | **8px — one value** | RP has 10 (`4px`×33, `2px`×31, `8px`×22, `3px`×22, `6px`×18, `100px`×16, `12px`, `5px`, `16px`, `10px`). 2px and 3px radii are the tell. 8px matches the shipped `--fb-r-sm` so we do not fork the decision. |
| `$RADIUS-PILL` | `999px` | the only exception; a shape, not a radius |
| `$BORDER-HAIRLINE` | `1px solid $N-100` | row divider — the **only** divider in a table |
| `$BORDER-CONTROL` | `1px solid $N-450` | input, select, checkbox — 3.58:1 |
| divider weight | **1px, always** | never 2px, never 3px, no per-cell vertical rules |

Vertical column rules get deleted outright. A table with a 1px rule under each row and none between
columns reads calm; RP's per-cell borders are what make the grid look like a 1998 spreadsheet.

---

## 5. Elevation — 2 steps

RP has 3 `$BOX_SHADOW--*` and components invent more inline. Two is enough.

| Token | Value | Use |
|---|---|---|
| `$E-1` | `0 1px 2px rgba(16,22,35,.06), 0 1px 3px rgba(16,22,35,.04)` | resting card, dashboard widget, sticky grid header |
| `$E-2` | `0 8px 24px rgba(16,22,35,.14), 0 2px 6px rgba(16,22,35,.08)` | overlays only — modal, popover, dropdown, tooltip |

Tables, rows, inputs and tabs get **no shadow**. They get a 1px border. Shadow is reserved to mean
"this floats above the page", so it stays meaningful.

---

## 6. Interaction

| State | Treatment |
|---|---|
| hover (row) | `background: $N-50`; `transition: background 120ms ease` |
| hover (accent surface) | `background: rgba(47,111,237,.06)` |
| active / pressed | `$N-100`, or `$ACCENT-PRESSED` for accent controls |
| **focus-visible** | `outline: 2px solid $ACCENT; outline-offset: 2px; border-radius: $RADIUS;` — on the rail, `$ACCENT` → `#6f9dff` |
| selected row | 3px `$ACCENT` left bar **plus** `rgba(47,111,237,.08)` fill — form *and* colour |
| disabled | `$N-300` foreground, `$N-50` fill, `cursor: not-allowed` |

Use `outline`, not `box-shadow`, for the ring: `outline` is not clipped by an `overflow: hidden`
ancestor, and `.sidebar-nav-btn` (`sidebarButton.scss:88`) and the grid header both set
`overflow: hidden`. A box-shadow ring disappears there.

**`outline: none` is banned unless the same rule supplies a replacement indicator.** The current
overlay has deleted the sidebar focus ring entirely (§7b) — focus is presently unreachable by
keyboard on the primary navigation, which is a WCAG 2.4.7 failure.

**Reconciling with the deployed `brand.css`.** That file declares its own `--fb-*` custom properties
and uses `!important` **555 times across ~516 rules** — a brute-force strategy forced on it because
it is `<link>`-ed in the static `<head>` while RP's own stylesheet is appended to `<head>` later by
the webpack runtime, so brand.css loses every specificity tie. Once these tokens land at source, the
generated block of `brand.css` (§7) is deleted and the remaining hand-written layer keeps only what
tokens cannot express. Target: **zero `!important`**.

---

## 7. The primitives — implementation plan, in order

Each is verified to exist. Landing 1–3 is what makes the change *visible*; 4–14 make it *coherent*.

| # | File | What changes |
|---|---|---|
| 1 | `app/src/common/css/variables/colors.scss` + `newColors.scss` | Remap all 140 `$COLOR--*` onto §3. Keep every variable **name** — that is what preserves the merge surface. Status vars point at §3.4, accent vars at §3.3, every grey at the `$N-*` ramp. |
| 2 | `app/src/common/css/variables/font-variable.scss` | `$FONT-*` families → `$FONT-UI` / `$FONT-MONO`; add `$FS-100…700`, `$LH-*`. Retire `$FONT-CONDBOLD`. |
| 3 | *(new)* `app/src/common/css/variables/space.scss` | `$SP-1…7`, `$RADIUS`, `$RADIUS-PILL`, `$BORDER-HAIRLINE`, `$BORDER-CONTROL`, `$ROW-H`, `$ROW-H-HEADER`. Auto-injected by `sass-resources-loader`; no import needed. |
| 4 | `app/src/common/css/variables/boxShadows.scss` | 3 shadows → `$E-1`, `$E-2`. |
| 5 | `app/src/common/css/common.scss` | `body` → `$N-25` canvas, `$FONT-UI`, `$FS-300`/`$LH-300`, `$N-800`. Add the global `:focus-visible` ring so **every** control inherits it. |
| 6 | **Table header** `components/main/grid/gridHeader/headerCell/headerCell.scss` | `height: 50px`→`$ROW-H-HEADER`; `font-size: 12px`→`$FS-100`; `color: $COLOR--gray-47`→`$N-600` (fixes the measured 4.15:1 failure); padding→`$SP-3 $SP-4`; drop `text-transform: uppercase` for sentence case with `letter-spacing: .04em`. **Do not add `overflow: hidden`** — it clips the sort arrow (`.arrow`, line 101) and filter icon (`.filter`, line 138), both absolutely positioned outside the cell box. |
| 7 | **Table cell** `components/main/grid/gridBody/gridRow/gridCell/gridCell.scss` | `padding: 15px 10px`→`$SP-3 $SP-4`; `vertical-align: top`→`middle`; `line-height: 24px`; `color`→`$N-800`. **Preserve `border-left-width` (`@include levels-desktop`, lines 19-33)** — it is the nesting-indent mechanism, not decoration. |
| 8 | **Table row** `components/main/grid/gridBody/gridRow/gridRow.scss` + `grid.scss` | Row = `$ROW-H` min, `border-bottom: $BORDER-HAIRLINE`, hover `$N-50`, selected = 3px accent bar + tint. Remove per-cell vertical borders. |
| 9 | **Status badge / defect chip** `pages/inside/common/launchSuiteGrid/defectStatistics/defectStatistics.scss` + `executionStatistics/executionStatistics.scss` | Chip = `$RADIUS-PILL`, `$SP-1 $SP-2`, `$FS-100`, §3.4 fill + text. Add the 4px severity stripe and the PB/AB/SI/ND/TI glyph. `no_data` → em-dash, never `0`. |
| 10 | **Button** `components/buttons/bigButton/bigButton.scss` + `ghostButton/ghostButton.scss` | One height (32 / 40), `$RADIUS`, `$FS-300` 600, `$SP-2 $SP-4`. Primary = `$ACCENT`; secondary = `$N-0` + `$BORDER-CONTROL`. Retire the `color-booger` lime variant. |
| 11 | **Input** `components/inputs/input/input.scss` + `componentLibrary/fieldText/fieldText.scss` | `$BORDER-CONTROL`, `$RADIUS`, `$SP-3 $SP-4`, `$FS-300`, placeholder `$N-500`. Focus = ring, not a colour swap. |
| 12 | **Sidebar** `layouts/common/sidebar/sidebar.scss` + `components/buttons/sidebarButton/sidebarButton.scss` | Rail `$N-RAIL`; resting ink `#c3cad6`; hover `rgba(255,255,255,.06)`; active = `#ffffff` + 2px `#6f9dff` left indicator. Replace `sidebarButton.scss:77-80` `border: 2px solid` with `outline: 2px solid #6f9dff; outline-offset: -2px`. Item height `56px`→`48px` (`$SP-6 × 1.5`). |
| 13 | **Tab** `components/main/navigationTabs/navigationTabs.scss` | Underline `2px $ACCENT` on active only; resting label `$N-500`, active `$N-800`; bottom rule `$BORDER-HAIRLINE`. |
| 14 | **Modal** `components/main/modal/modalLayout/modalLayout.scss` | `$RADIUS`, `$E-2`, header/footer separated by `$BORDER-HAIRLINE`, body padding `$SP-5`. |
| 15 | **Tooltip / popover** `components/main/tooltips/tooltip/tooltip.scss` + `componentLibrary/tooltip`, `componentLibrary/popover` | `$N-800` fill, `$N-0` text, `$RADIUS`, `$FS-200`, `$E-2`. |
| 16 | **Slider** `components/inputs/inputSlider/inputSlider.scss` | Rail `$N-100`, track + handle `$ACCENT`, mark text `$N-500` / active `$N-800`. Container stays transparent. |

`componentLibrary/plainTable` is RP's newer table primitive — align it to #6-8 so both table
generations land together.

---

## 8. Sequencing

**Must land first (blocking, single PR, one reviewer):** #1–5, the variable files. They are the only
change that propagates. Reviewing them together is also the only way to catch a status colour that
accidentally became the accent.

**Then, parallel (independent files, no shared surface):** #6-8 (table) ‖ #10-11 (button+input) ‖
#12 (sidebar) ‖ #13-15 (tab, modal, tooltip). Four reviewers, no conflicts.

**Last:** #9 (badge/chip) and #16 (slider), because they consume both the colour ramp *and* the
density tokens and are cheap to redo if #1-5 shift in review.

**Risky — flag on every PR:**
- `colors.scss` / `newColors.scss` are upstream-owned and change most releases. Keeping every
  variable **name** and changing only its value keeps the conflict to a one-line-per-variable value
  diff instead of a structural rebase. Renaming a variable would be the single worst thing we could do.
- #6-8 touch `components/main/grid/**`, RP's most actively developed area. Expect a merge on every
  upgrade. Budget for it; do not restructure the markup, only the declarations.
- `common.scss` global `:focus-visible` can double-ring components that already define their own.
  Sweep for `outline: none` in the same PR.
- Deleting webfonts (#2) drops `common/css/fonts/**`. Verify no component references a family
  directly rather than through `$FONT-*`.

**Already themed — respect, do not undo:**
- `fastbreak-platform/deploy/rp/service-ui/assets/brand-nav.js` — the DOM sidebar overlay from the
  earlier branding effort. It was **deliberately removed** from injection (`deploy/rp/service-ui/Dockerfile:31-35`,
  with a build-time guard at line 48 that fails the image if it comes back) because it hid RP's native
  sidebar and hardcoded the project to `nba`. The file still exists but must stay un-injected. #12
  restyles the **native** sidebar; it does not resurrect the overlay.
- `brand.css` §2 (sidebar), §3 (surfaces) and §8 (structural fixes) are hand-written, correct, and
  diagnosed the launches-grid per-cell-border problem before we did. Port those intents into #8 and
  #12, then delete the CSS.
- `pages/inside/logsPage/logItemInfo/logItemInfoTabs/streamPulse/**` — the Observability tab. Freshly
  deployed, currently modified in the working tree by another agent. **Do not touch.** It should
  consume these tokens later, in its own PR, after #1-5 land.

---

## 9. Open

- Confirm SYSTEM ISSUE → violet `#5a4bd0` (§3.4). It is the one change that breaks RP muscle memory.
- Dark mode: `newColors.scss` carries a full `$COLOR--darkmode-*` set. Out of scope here; the ramp is
  built so a dark mode is a second set of `$N-*` values, not a second design.
