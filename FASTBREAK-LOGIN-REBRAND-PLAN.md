# FASTBREAK Login Rebrand — Design Plan

Status: **proposed. Nothing in this document has been applied.**
Owner: Staff Designer, FASTBREAK.
Scope: the **logged-out** surface of the RP fork (login, registration, not-found, account-removed),
plus the favicon/title/attribution that follow from it.

Live image at time of writing: `fastbreak/service-ui:5.15.3-fb35` (verified running as `rp-ui-1`,
`docker images` shows it tagged and in use). Rollback target — §7.

---

## 0. Verification status — read this before trusting any claim below

Nobody can log in to this instance, so **the logged-out login page (`http://localhost:8080/ui/`) is the
only surface checkable by render.** I have partitioned every claim accordingly.

**Verified by me, this session, against the running container or the fork tree:**

| Claim | How verified |
|---|---|
| `<title>FASTBREAK</title>` already ships | `curl /ui/` — title present, plus `brand-auth.js`, `brand.css`, `brand.js` all injected with `?v=` cache-busts |
| RP teal wordmark still served on login | `curl -o /dev/null /ui/media/logo.84e9caf8.svg` → HTTP 200, 9367 bytes |
| **`media/*.svg` carries NO SRI** | `index.html` in the container has exactly **4** `integrity=` attributes; `grep -c "media/logo" index.html` = **0**. Only `favicon.ico`, `polyfills`, `main.app`, `main_app` are stamped. **This is the load-bearing fact for the recommendation in §3.** |
| The login logo is an **empty `<div>` inside an `<a>` with no accessible name** | `loginPage.jsx:147-154` — `<a href={referenceDictionary.rpLanding} target="_blank"><div className={cx('logo')} /></a>`. No `alt`, no `aria-label`, no text child |
| Logo geometry `140×30`, `background-size: 100%`, mobile `100×25` | `loginPage.scss:74-95` |
| Login left panel = `#effafb` + `login-page-bgc.svg` (fills `#D0F0F1` / `#D7F3F4` / `#FCFEFE` / white) | `loginPage.scss:52-62`; `colors.scss:65`; SVG fill scan |
| RP logo teal = `#009BB9`, secondary `#323C5C` | `common/img/logo.svg` fill scan |
| Two live third-party JSONP calls from the logged-out page | `serviceVersionsBlockWithData.jsx:38` → `status.reportportal.io/versions`; `newsBlockWithData.jsx:27` → `status.reportportal.io/twitter?count=3` |
| 7 outbound RP social links | `socialsBlock.jsx` — github, facebook, twitter, youtube, linkedin, slack, mailto, all via `referenceDictionary` |
| `ReportPortal.io` bare JSX literal, no message id | `registrationPage.jsx:135` |
| `© Report Portal <year>` in footer | `layouts/common/footer/footer.jsx:70` — **authenticated layout only, not on the login page** |
| **A FASTBREAK icon mark DOES exist** | `deploy/rp/service-ui/assets/fastbreak-mark.svg`, 261 bytes. See §2 — the brief's "no logo asset" is half right |
| No email templates in this repo | `find` for `*.ftl` / `*email*` returns only integration UI. Email bodies live in `service-api` (Java/Freemarker), **out of scope, not inspected** |
| Rollback image exists locally | `docker images` → `fastbreak/service-ui:5.15.3-fb35`, in use |
| All contrast ratios in §5 | computed with the WCAG 2.x relative-luminance formula, not estimated |

**NOT verified — stated as risk, not fact:**

- I have **not rendered** any proposed design. Every "it will look like X" below is intent, not result.
- I have not rendered the authenticated app at all. Sidebar/footer/modal claims are source-read only.
- Safari's handling of the `data:image/svg+xml` favicon that `brand.js` injects is **unverified**.
- Whether the team has published doc URLs to link to (§4) is **unknown** — open question.

**Refuted, do not plan around it:** the favicon SRI "trap". SRI is genuinely stamped on
`favicon.ico`, but browsers do not enforce `integrity` on `<link rel="icon">` (destination `image`
is not SRI-eligible), and it is doubly moot because `brand.js` strips every icon link at runtime.
The only real hygiene issue is that swapping `favicon.ico` bytes without a webpack rebuild leaves a
**stale, now-false `integrity` attribute** in `index.html`. Cosmetically wrong, functionally inert.

---

## 1. WHAT CHANGES — complete surface inventory

### 1.1 Login page — `app/src/pages/outside/loginPage/`

| # | Element | File / line | Today | Defect class |
|---|---|---|---|---|
| L1 | Wordmark | `loginPage.scss:74-95` → `~common/img/logo.svg` (served `/ui/media/logo.84e9caf8.svg`) | RP teal wordmark, 140×30 | Brand |
| L2 | Logo link target | `loginPage.jsx:148` → `referenceDictionary.rpLanding` = `http://reportportal.io/` | Logo opens reportportal.io in a new tab | Brand + trust |
| L3 | **Logo accessible name** | `loginPage.jsx:147-154` | `<a>` wrapping an empty `<div>`. **Zero accessible name.** SR announces "link", nothing more | **A11y — WCAG 2.4.4 + 4.1.2 fail** |
| L4 | Left decorative panel | `loginPage.scss:52-62` + `img/login-page-bgc.svg` (+ tablet/mobile variants) | RP teal wash `#effafb`/`#D0F0F1` | Brand |
| L5 | News / tweet block | `socialSection/newsBlock/newsBlock.jsx`, `newsBlockWithData.jsx:27` | Live-fetches RP marketing tweets by JSONP | Brand + privacy + honesty |
| L6 | News block empty state | same | If the fetch fails, renders the heading "Be informed with our latest tweets" over **zero posts** — a titled empty box with no explanation | **Honesty / dead-end state** |
| L7 | Socials strip (7 links) | `socialSection/socialsBlock/socialsBlock.jsx` + 21 SVGs under `socialsBlock/img/` | All 7 point at RP properties | Brand |
| L8 | Section separator | `socialSection/sectionsSeparator/` | decorative | Cosmetic |
| L9 | Version line | `pageBlocks/serviceVersionsBlock/serviceVersionsBlockWithData.jsx:38` | JSONP to `status.reportportal.io/versions` to decide "New versions are available." | Brand + privacy. **Degrades honestly** — on failure it falls back to "Current version" from local `appInfo`. Safe to block |
| L10 | Privacy policy link | `pageBlocks/policyBlock/policyBlock.jsx` → `referenceDictionary.rpEpamPolicy` | EPAM policy. Only renders when `instanceType` is `EPAM`/`SAAS` — **likely not rendering here**, unverified | Brand (conditional) |
| L11 | Login form focus ring | `brand.css:470` — `outline:none !important; box-shadow: var(--fb-ring)` | Ring is a `box-shadow`, which is **clipped by any `overflow:hidden` ancestor** | **A11y — see §5.3** |

### 1.2 Registration page — `app/src/pages/outside/registrationPage/`

| # | Element | File / line |
|---|---|---|
| R1 | Same RP wordmark, identical 140×30 block | `registrationPage.scss:95` |
| R2 | **`ReportPortal.io`** — bare JSX literal, no message id, invisible to i18n tooling | `registrationPage.jsx:135` |
| R3 | `rpLanding` href on that link | `registrationPage.jsx:134` |
| R4 | "User Name will be used for log in to the system of ReportPortal" | `registrationForm/registrationForm.jsx:57` |

### 1.3 Not-found page — `app/src/pages/outside/notFoundPage/`

| # | Element | File / line |
|---|---|---|
| N1 | Desktop logo → `~layouts/common/img/logo.svg` (**a third, different logo file**, 706 bytes) | `notFoundPage.scss:145` |
| N2 | Mobile override → `~common/img/logo.svg` | `notFoundPage.scss:149` |

### 1.4 Account-removed page — `app/src/pages/outside/accountRemovedPage/`

| # | Element | File / line |
|---|---|---|
| A1 | `import Logo from 'common/img/logo.svg'`, rendered `<Image src={Logo} />` — **a JS module import, not CSS** | `accountRemovedPage.jsx:29, 78` |
| A2 | "Your account and personal data have been deleted from ReportPortal database." | `accountRemovedPage.jsx:42` |
| A3 | "Thank you for using ReportPortal" | `accountRemovedPage.jsx:46` |

### 1.5 Global chrome

| # | Element | File / line | Note |
|---|---|---|---|
| G1 | `<title>Report Portal</title>` | `app/src/index.tpl.html:6` | **already sed-patched to FASTBREAK** in the overlay Dockerfile; `brand.js` re-asserts it via MutationObserver because react-helmet rewrites it per route |
| G2 | `favicon.ico` | `app/src/common/img/favicon.ico` (4641 B), served `/ui/favicon.ico` with SRI | **already replaced at runtime** by `brand.js` with a `data:` URI SVG. Stale integrity attr remains |
| G3 | Mobile header logo | `layouts/common/mobileHeader/mobileHeader.scss:66` → `common/img/logo.svg` | authenticated |
| G4 | Footer `© Report Portal <year>` | `layouts/common/footer/footer.jsx:70` | authenticated only |
| G5 | Premium promo modal `<img alt="ReportPortal" src={LogoWhite} />` | `.../premiumPromoModal.jsx:58` | authenticated |
| G6 | Support block: "ReportPortal is free and open source under the Apache 2.0 license…" | `layouts/common/sidebar/supportBlock/messages.js:56` | authenticated |
| G7 | **`common/utils/referenceDictionary.js`** — ~28 `reportportal.io` URLs | whole file | **the single genuine choke point** for outbound links |

### 1.6 Logo assets — there are THREE, not one

| Path | Size | Consumed by |
|---|---|---|
| `app/src/common/img/logo.svg` | 9367 B, `viewBox="0 0 148 31"`, `#009BB9` + `#323C5C` | login, registration, not-found (mobile), mobileHeader, accountRemoved |
| `app/src/common/img/logo-white.svg` | 9367 B | premium promo modal (authenticated) |
| `app/src/layouts/common/img/logo.svg` | 706 B | not-found (desktop) |

Compiled to `/usr/share/nginx/html/media/logo.84e9caf8.svg` and `logo-white.9f79de55.svg`.
**Neither carries SRI.**

### 1.7 Localization

`app/localization/translated/` holds `be/es/ru/uk/zh.json` + whitelists. **There is no `en.json`** —
English lives in `defaultMessage` inside the JSX and is compiled into the bundle. Consequence:
**English product copy cannot be changed without a source rebuild.** No overlay can touch it.

### 1.8 Email templates

Not in this repo. They are Freemarker templates in `service-api`. **Out of scope. Not inspected.**
Flag for a follow-up: password-reset and invitation emails will still say ReportPortal.

---

## 2. THE FASTBREAK MARK

### 2.1 Honest current state

The brief says there is no FASTBREAK logo asset. **That is half right and the half matters.**

- There **is** an icon: `deploy/rp/service-ui/assets/fastbreak-mark.svg`, **261 bytes** — a `#4C8DFF`
  rounded square (r=54 on a 256 box) with a `#0B0E14` play-arrow glyph. It is inlined base64 into
  `brand.css:9` on `[class*="corner-area"]`, and a variant is injected as the favicon by `brand.js`.
- There is **no wordmark**. The tab title is text-only, and the login page shows RP's teal wordmark.
- Design judgement on the existing icon: **serviceable as a favicon, not adequate as the brand.** A
  blue rounded square with a play triangle is the single most common shape in software; it reads as
  a generic media-player button. It also mixes two blues with the system — `#4C8DFF` is **not**
  `$ACCENT #2f6fed`. That is a second, undeclared brand blue and it should not survive.

### 2.2 What is actually needed

| Asset | Format | Purpose |
|---|---|---|
| **Wordmark** | SVG, `viewBox="0 0 148 31"` | drop-in replacement for `media/logo.84e9caf8.svg`. The 148×31 viewBox is **non-negotiable** — the div is 140×30 with `background-size:100%`, so a different aspect ratio letterboxes or overflows |
| **Wordmark, reversed** | SVG, same viewBox | replacement for `media/logo-white.9f79de55.svg` (dark surfaces, promo modal) |
| **Wordmark, compact** | SVG, same viewBox | for the 100×25 mobile override, `loginPage.scss:88-93` |
| **Icon / app mark** | SVG, `viewBox="0 0 256 256"` | favicon source, PWA, future avatar |
| **Lockup** (icon + wordmark) | SVG | *deferred* — see §2.5 |
| **Favicon set** | `.ico` @ 16/32/48 multi-res; `favicon-32.png`, `favicon-192.png`, `favicon-512.png`, `apple-touch-icon-180.png` | a `data:` SVG alone is not a favicon strategy. Safari SVG-favicon support is **unverified here** |

### 2.3 Interim: a TYPOGRAPHIC WORDMARK — no designer-drawn logo required

This is the recommendation. It ships now, costs zero design hours, and is honest about being an
interim rather than pretending to be a finished identity.

**Spec — all values from `FASTBREAK-DESIGN-TOKENS.md`, no second system invented:**

| Property | Value | Source |
|---|---|---|
| Text | `FASTBREAK` (uppercase, one word, no space) | — |
| Typeface | `$FONT-UI` — `-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, 'Helvetica Neue', Arial, sans-serif` | tokens §1 |
| Weight | **700** | tokens §1 (`$FS-700` is the only 700 in the scale; a wordmark is the right place for it) |
| Letter-spacing | **+0.06em** | uppercase at display size needs positive tracking; below +0.05em the `ST` and `AK` pairs close up |
| Case | uppercase, no lowercase variant | — |
| Colour, light surfaces | **`$N-800` `#172b4d`** | tokens §3.2 |
| Colour, dark rail | **`#ffffff`** | tokens §3.5 |
| Accent usage | **none.** Do not colour the wordmark `$ACCENT` | tokens §3.1: colour is reserved for status. A permanently-blue wordmark on every page devalues the accent |
| Cap height | 20px within the 31px viewBox | leaves 5.5px optical padding top and bottom |
| Width pinning | `textLength="148" lengthAdjust="spacingAndGlyphs"` | **required** — see below |

**Why `textLength` is required and not optional.** An SVG used as a CSS `background-image` renders in
an isolated document that can use *system* fonts but **not webfonts**. The system stack therefore
works — but it resolves to SF Pro on macOS, Segoe UI on Windows, Roboto on Android. Those have
different advance widths, so an unpinned `<text>` wordmark would be a different pixel width per OS
and would either underfill or overflow the 140px box. `textLength` + `lengthAdjust` pins it. This is
the honest trade: **slightly different letterforms per OS, identical footprint.**

**Path to permanence:** once a typeface is locked, convert `<text>` → `<path>` outlines. Outlines are
the only way to guarantee byte-identical rendering everywhere, and they remove the OS dependency
entirely. Until then, the `<text>` version is explicitly labelled interim in the asset's own
`<!-- -->` header so nobody mistakes it for a finished mark.

### 2.4 Clear space and minimum size

| Rule | Value | Basis |
|---|---|---|
| Minimum clear space | **0.5 × cap height = 10px** on all four sides at the 140×30 rendering | standard; the login placement (`top:30 left:60`) already exceeds this comfortably |
| Smallest legible width | **100px** — the existing `$SCREEN_XS_MAX` override | 100px / 9 glyphs ≈ 11.1px advance → ~16px effective size, cap height ~11px. Legible but **at the floor**. Do not go below 100px |
| Below 100px | **use the icon only, never a shrunken wordmark** | 9 uppercase glyphs below 100px is illegible, not small |
| Favicon | icon only. The wordmark must never be rendered at 16px | — |

### 2.5 What is explicitly deferred

- **The lockup** (icon + wordmark side by side). At 148×31 with a 31×31 icon, the wordmark gets 109px
  — under the 100px floor once the 8px gap is taken. **A lockup does not fit the existing box.**
  Shipping one requires widening the `.logo` div, which is a fork-source SCSS change. Defer.
- **A drawn icon** replacing the play-arrow square. Needs a real design pass and a decision on whether
  FASTBREAK has a symbol at all. Interim: keep the existing icon **but restate its blue as
  `$ACCENT #2f6fed`** so there is one brand blue, not two.

---

## 3. OPTIONS AND RECOMMENDATION

### Option A — Overlay only

Change nothing in `app/src`. Work entirely in `deploy/rp/service-ui/`:
overwrite `/usr/share/nginx/html/media/*.svg` and `favicon.ico` in the image; restyle via
`brand.css`; patch DOM **attributes** via `brand.js`; tighten CSP in `nginx.conf`.

- **Cost:** measured **0.96s** overlay build (`build-and-deploy.sh <tag> --no-native`).
- **Upgrade friction:** near zero. The seds key off `index.html`/`nginx.conf`, both stable across
  chunk-hash churn. The one exposure is the content hash in `media/logo.84e9caf8.svg`, which changes
  if upstream touches the file — mitigated by globbing and asserting (see §7 Phase 1).
- **Ceiling:** cannot change compiled English strings; cannot change DOM structure; cannot remove the
  `<a>` element itself.

### Option B — Fork-source edits

Edit `app/src` and rebuild the native image.

- **Cost:** full webpack build, `npm ci --legacy-peer-deps && npm run build` at a 6 GB Node heap
  (the Dockerfile comment records a prior OOM/SIGKILL at default heap). Minutes, not seconds.
- **Upgrade friction:** highest. `referenceDictionary.js` is upstream-owned and churns most releases;
  every RP bump becomes a real source rebase.
- **Ceiling:** none. Full control.

### Option C — Hybrid

### RECOMMENDATION: **Option C, overlay-first**, split on this rule

> **The overlay owns files, styles, and DOM *attributes*. The fork owns *text* and *structure*.**

Concretely:

| Concern | Layer | Why |
|---|---|---|
| All 3 logo SVGs, favicon set | **Overlay** — overwrite `/usr/share/nginx/html/media/*` | **I verified `media/*.svg` has zero SRI entries in `index.html`.** This is a free, zero-rebase file swap and it is the highest-visibility change on the page |
| Login-panel colour, hiding the news/socials blocks, the replacement panel's styling | **Overlay** — `brand.css` | CSS-only, zero rebase |
| **Logo `href` → FASTBREAK, and `aria-label="FASTBREAK — go to home"`** | **Overlay** — `brand.js` | These are *attributes*, not text. `brand.js` already runs a MutationObserver for `<title>`; the same pattern fixes L2 and **L3, the a11y defect**, with zero rebase cost |
| Blocking `status.reportportal.io` JSONP | **Overlay** — `nginx.conf` CSP `script-src` | one sed |
| The replacement panel's **content** | **Overlay** — `brand.js` injecting into the emptied `.social-section` | see the caveat below |
| English `defaultMessage` strings (R2, R4, A2, A3, G4, G6) | **Fork** | CSS cannot do text; DOM-patching text is the wrong tool — it is unselectable, untranslatable, and invisible to assistive tech |
| `referenceDictionary.js` (G7) | **Fork** | ~28 URLs, upstream-owned; this is the rebase tax and it is worth paying once |
| Removing `SocialSection` from the JSX | **Fork** | structure |

**Justification against upgrade friction.** The fork must track upstream RP. Option B would put the
entire rebrand — including the logo, which is 90% of the perceived change — into the rebase-taxed
layer, for no benefit: a file swap and an attribute patch do not need a compiler. Option A alone is
also wrong, because it would leave FASTBREAK's own logo hyperlinked to reportportal.io and would ship
compiled copy that still says "ReportPortal" on the registration and account-removed pages. The split
above puts **everything cheap in the cheap layer** and confines the rebase surface to one utility
file plus a handful of `defaultMessage` strings.

**Caveat I will state plainly rather than bury:** injecting the replacement panel via `brand.js` is
the weakest part of this plan. JS-injected DOM is fragile against React re-render, is not
server-rendered, and flashes. It is acceptable for the **login page specifically** because that logo
and panel are static after mount (verified: `LoginPage` is a `PureComponent`, the panel is not
re-keyed). If Phase 3 shows any flash or re-render loss, **promote the panel to fork-source** — do not
escalate the JS workaround.

---

## 4. THE SOCIAL PANEL DECISION

**Remove it.** RP's marketing tweets and 7 links to EPAM properties have no place on a FASTBREAK
login. Beyond brand: it is a **live third-party JSONP call from an unauthenticated page**, which
executes remote script in our origin, and it has a **dead-end failure state** (L6 — a heading with
zero posts and no explanation).

That leaves an empty **50%-width, ~700px-tall** column. That must not ship empty.

### What fills it — "This deployment"

Everything below is **sourced locally or is a static fact**. Nothing is fetched, nothing is inferred,
nothing is fabricated.

```
┌──────────────────────────────────────┐
│                                      │
│   FASTBREAK            ← wordmark, $N-800, ~2× login size
│                                      │
│   Test evidence for the NBA mobile   │  ← one honest line, $FS-400 / $N-600
│   and OTT apps.                      │
│                                      │
│   ────────────────────────────       │  ← 1px $N-100 hairline
│                                      │
│   Docs      → <team docs URL>        │  ← $ACCENT links, $FS-300
│   Runbook   → <team runbook URL>     │
│                                      │
│   ────────────────────────────       │
│                                      │
│   FASTBREAK is built on ReportPortal │  ← attribution, $FS-200 / $N-500
│   (Apache-2.0, © 2016 EPAM Systems)  │     see §6
│                                      │
└──────────────────────────────────────┘
```

**Design rules for this panel — these are invariants, not preferences:**

1. **No fabricated data.** If a build/version value is not present in `appInfo`, the row is **omitted
   entirely**. It never renders `0`, never renders `unknown`, never renders an empty value styled to
   look populated. Per `FASTBREAK-DESIGN-TOKENS.md` §3.4: absent ≠ zero.
2. **No fetched content.** The panel makes no network call. The whole reason the RP block is going is
   that it did.
3. **No marketing.** One descriptive line. No claims, no counts, no "trusted by".
4. **Links must resolve.** A link to a 404 is worse than no link. **Open question — see §8.**

**Fallback if no doc URLs exist yet:** ship the panel with the wordmark, the descriptor line, and the
attribution only. A shorter honest panel is correct; placeholder links are not.

**Also removed with it:** the version JSONP (L9). It degrades honestly to "Current version" backed by
local `appInfo` — verified by reading the component, `latestVersions` stays `null`, `isDeprecated`
stays `false`, and the local-data tooltip still renders.

---

## 5. ACCESSIBILITY — computed, not estimated

All ratios computed with the WCAG 2.x relative-luminance formula.

### 5.1 Wordmark contrast

Backgrounds are real: `#effafb` is `$COLOR--light-blue` (`colors.scss:65`); `#D0F0F1` is the darkest
fill in `login-page-bgc.svg` and is the **worst case** the wordmark sits on.

| Foreground | on `#effafb` (panel) | on `#D0F0F1` (worst point of bg art) | on `#ffffff` | on `#111722` (`--fb-rail`) |
|---|---|---|---|---|
| **`$N-800` `#172b4d`** ← **recommended** | **13.25:1** | **11.70:1** | **14.10:1** | 1.27:1 ✗ |
| `#101623` (`--fb-ink`) | 17.00:1 | 15.00:1 | 18.09:1 | 1.01:1 ✗ |
| `$ACCENT` `#2f6fed` | **4.27:1** ✗ AA-normal | **3.77:1** ✗ | 4.55:1 | 3.95:1 |
| `#4C8DFF` (current mark blue) | 3.01:1 ✗ | 2.65:1 ✗ | 3.20:1 | 5.61:1 |
| **`#ffffff`** ← **recommended on rail** | 1.06:1 ✗ | 1.21:1 ✗ | — | **17.96:1** |
| `#6f9dff` (token rail accent) | 2.48:1 ✗ | 2.19:1 ✗ | 2.64:1 | **6.79:1** |
| *RP incumbent* `#009BB9` | **3.09:1** | 2.73:1 | 3.29:1 | 5.46:1 |

**Calls:**

- **Light: `$N-800` `#172b4d` at 13.25:1** (11.70:1 worst-case over the art). Enormous headroom.
- **Dark rail: `#ffffff` at 17.96:1.** If the rail moves to the tokens' `$N-RAIL #16233a`, white is
  15.72:1 — still fine.
- **`$ACCENT #2f6fed` is rejected for the wordmark** at 4.27:1 on `#effafb` — it misses AA-normal
  (4.5:1) and drops to **3.77:1** over the background art. It clears the 3:1 large-text threshold, and
  logos are formally exempt from 1.4.3 — but a wordmark that fails normal-text AA on its own login
  panel is a bad look for a product whose design system opens with a contrast table. Use `$N-800`.
- **Honest note on the incumbent:** RP's own teal `#009BB9` is **3.09:1**, i.e. the current login page
  is already at the floor. Any of the recommended values is a strict improvement.
- `#4C8DFF` (the existing icon blue) is **3.01:1** on the panel — another reason to restate the icon
  in `$ACCENT` and never use either blue for the wordmark on light.

### 5.2 Alt text — this is a live defect, not a nice-to-have

`loginPage.jsx:147-154` renders `<a href="http://reportportal.io/" target="_blank"><div class="logo" /></a>`.
An anchor whose only child is an empty div has **no accessible name at all**. This is a
**WCAG 2.4.4 (Link Purpose)** and **4.1.2 (Name, Role, Value)** failure and it is on the very first
screen. *(Verifiable on the logged-out page.)*

**Fix, overlay layer, `brand.js`:**

```
a[href*="reportportal.io"] > [class*="loginPage__logo"]  → patch the parent <a>:
  href       = "/ui/"                       (stop sending users to a vendor site)
  aria-label = "FASTBREAK — go to home"
  remove target="_blank" and rel            (an external-tab jump from a logo is itself a dead-end)
```

The same treatment applies to `registrationPage` and `notFoundPage` logos.
For `accountRemovedPage.jsx:78` (`<Image src={Logo} />`) the fix is **fork-source** — add
`alt="FASTBREAK"` to the `<Image>`.

### 5.3 Focus-visible on the login form

`brand.css:470` currently does:

```css
outline:none !important; border-color:var(--fb-accent) !important; box-shadow:var(--fb-ring) !important;
```

Two problems, both already diagnosed in `FASTBREAK-DESIGN-TOKENS.md` §6:

1. **`box-shadow` rings are clipped by any `overflow:hidden` ancestor.** `outline` is not. The login
   card sets `overflow:hidden` at `$SCREEN_XS_MAX` (`loginPage.scss:49`), so the ring can vanish on
   mobile.
2. `--fb-ring` is `0 0 0 3px rgba(47,111,237,.18)` — **18% alpha**. Composited over `#ffffff` that is
   roughly `#e8effc`, contrast to white ≈ **1.15:1**, far under the **3:1** that WCAG 1.4.11 requires
   of a focus indicator. It is decoration, not an indicator.

**Fix, `brand.css`, login inputs and the submit button:**

```css
outline: 2px solid #2f6fed;   /* $ACCENT — 4.55:1 on #ffffff, 4.28:1 on the #f7f8fa canvas; both > 3:1 */
outline-offset: 2px;
```

Keep the soft `box-shadow` as an *additional* affordance if desired, but the `outline` is the
indicator. **`outline:none` is banned unless the same rule supplies a replacement.**

### 5.4 Meaning never by colour alone

The login page carries no status encoding, so this is mostly N/A here — **except the error state**,
which is the thing that cost a day. Any auth failure must render as: a severity-coloured stripe **and**
an icon **and** text that states what went wrong **and** what to do next. "Email is incorrect" with no
recovery path is exactly the dead-end this role exists to catch. **Not verified in this pass** — the
error state needs its own render check in Phase 3 (§7).

---

## 6. LICENSING / ATTRIBUTION

**License: Apache-2.0, unmodified, EPAM Systems.** Not dual-licensed, no commons-clause. It expressly
permits commercial use, modification, rebranding, and closed-source derivatives. **Nothing in this
plan is blocked by the license.**

### 6.1 What must be retained

| Obligation | Source | Practical effect |
|---|---|---|
| **§4(c)** — retain all copyright/patent/trademark/attribution notices in Source form | LICENSE §4(c) | The ~2,970 `Copyright <year> EPAM Systems` headers in `app/src` **stay**. **Do not let a find/replace rebrand sweep strip them.** This is the single highest-risk mistake available here |
| **§4(a)** — give recipients a copy of the License | LICENSE §4(a) | ship `LICENSE` |
| **§4(d)** — reproduce the `NOTICE` contents | LICENSE §4(d) | the whole NOTICE is 3 lines: `ReportPortal <https://reportportal.io>` / `Copyright (C) 2016 EPAM Systems, Inc.` / `This project may include or depend on other open source projects.` |
| **§6** — no trademark grant | LICENSE §6 | We may **not** brand the product as ReportPortal or imply EPAM endorsement. Removing their branding is therefore the *conservative* path, not a risky one |

**These bind on DISTRIBUTION, not on internal use.** If this instance never leaves the organisation,
§4 is not triggered.

### 6.2 Concrete recommendation

1. **Ship the attribution anyway.** It costs three lines, it removes the question permanently, and
   §4(d) explicitly permits satisfying it "within a display generated by the Derivative Works" — which
   is exactly the panel in §4.
2. **Exact string and exact placement — bottom of the login left panel, `$FS-200` / `$N-500` `#626f86`
   (5.08:1 on white, AA):**

   > FASTBREAK is built on ReportPortal (Apache-2.0, © 2016 EPAM Systems, Inc.).

   Wording is deliberately **factual and descriptive** — it states origin, which is precisely the §6
   carve-out, and it does not imply partnership, endorsement, or certification.
3. **Serve the full texts** at `/ui/LICENSE.txt` and `/ui/NOTICE.txt` (overlay `COPY`, one line each in
   the Dockerfile), and link "Apache-2.0" in the line above to `/ui/LICENSE.txt`.
4. **Guard the headers.** Add a build-time assertion in the same style as the existing `brand-nav.js`
   guard: fail the image if the EPAM header count in `app/src` drops. Cheap insurance against a future
   sweep.

### 6.3 Legal judgement calls — USER MUST CONFIRM

- **Is this distributed?** If FASTBREAK is ever shipped to a customer, embedded in a product, or
  demoed externally, §4 attaches in full. **I am not qualified to make this call and have not made it.**
- **"Powered by ReportPortal" vs the descriptive line above.** "Powered by" is a common phrasing but
  edges toward *using their mark as a badge*. The descriptive "built on … (Apache-2.0, © EPAM)" is
  strictly safer under §6. **Recommend the descriptive form; user/legal to confirm.**
- **Whether the attribution may live only in `/ui/NOTICE.txt`** rather than on-screen. §4(d) permits
  documentation placement. On-screen is belt-and-braces. Design preference: keep it on-screen — it
  fills the panel honestly and it is a mark of a team that does this properly.

---

## 7. PHASED SEQUENCE

Build command throughout: `deploy/rp/service-ui/build-and-deploy.sh <tag> --no-native`
(**`--no-native` skips the expensive webpack rebuild** — use it for every overlay-only phase).

### Phase 0 — Author the assets (no deploy)

Produce: wordmark SVG (`viewBox="0 0 148 31"`, `$N-800`, `textLength="148"`), reversed variant,
compact variant, icon restated in `$ACCENT #2f6fed`, favicon `.ico` (16/32/48) + PNG set.
**Verify:** open each SVG standalone in Chrome, Safari, Firefox; confirm the wordmark occupies exactly
148×31 in all three (this is the `textLength` check); confirm legibility rendered at 100px wide.

### Phase 1 — Logo + favicon swap (overlay)

Overwrite in the image: `/usr/share/nginx/html/media/logo.84e9caf8.svg`,
`media/logo-white.9f79de55.svg`, `/usr/share/nginx/html/favicon.ico`, plus the PNG set.
**Use a hash-agnostic glob** (`media/logo*.svg`) and **assert the target existed before overwriting** —
same discipline as the existing `grep -q` assertions — because those content hashes change on any RP
release that touches the file.
**Verify (render-checkable):** load `/ui/` in a browser; the login logo is the FASTBREAK wordmark;
`curl -s /ui/media/logo.84e9caf8.svg | head -1` shows our SVG; the tab shows the new favicon;
hard-reload with cache disabled. Screenshot and diff against the pre-change screenshot.

### Phase 2 — Kill the RP outbound surface (overlay)

`brand.css`: hide `.news-block` and `.socials-block`. `nginx.conf` CSP: drop
`status.reportportal.io` from `script-src`. `brand.js`: patch the logo `<a>` — `href="/ui/"`,
`aria-label="FASTBREAK — go to home"`, remove `target="_blank"`.
**Verify (render-checkable):** DevTools Network on `/ui/` shows **zero** requests to any
`reportportal.io` host; DevTools Elements shows the `<a>` with the new `href` and `aria-label`; the
version line still reads "Current version" with a populated local tooltip (**not** blank, **not** "New
versions available"); an accessibility-tree inspection shows the logo link with a name.

### Phase 3 — The replacement panel + focus ring (overlay)

`brand.js` injects the §4 panel into the emptied left column. `brand.css` swaps the input/button focus
`box-shadow` for `outline: 2px solid #2f6fed; outline-offset: 2px`.
**Verify (render-checkable):** left column is filled, not empty; **Tab** through the form — every
control shows a visible ring, including at a 320px viewport where `overflow:hidden` is active;
deliberately submit bad credentials and **screenshot the error state** — confirm it names the problem
*and* a next action (this is the specific regression this whole review exists to prevent); confirm no
flash/loss of the panel on resize and on the forgot-password route toggle.

### Phase 4 — Source strings and links (fork, expensive)

`referenceDictionary.js` (G7); `registrationPage.jsx:135` (R2) — **give it a message id while you are
there**; `registrationForm.jsx:57` (R4); `accountRemovedPage.jsx:42,46,78` (A2/A3/A1 — add
`alt="FASTBREAK"`); `footer.jsx:70` (G4); `supportBlock/messages.js:56` (G6);
`premiumPromoModal.jsx:58` alt (G5). Remove `<SocialSection />` from `loginPage.jsx` and delete the
`socialSection/` tree + 21 social SVGs. **Do not touch any EPAM copyright header.**
Full rebuild (no `--no-native`).
**Verify:** `grep -r "ReportPortal\|Report Portal" app/src --exclude-dir=node_modules` returns **only**
license headers, test fixtures, and the intentional attribution line; EPAM header count unchanged
(`grep -rl "EPAM Systems" app/src | wc -l` still ≈ 2970); re-render and re-screenshot the login,
registration, and 404 pages.

### Phase 5 — Licence artefacts

`COPY LICENSE NOTICE` into the image root; link them from the panel's attribution line.
**Verify:** `curl -s /ui/LICENSE.txt | head -3` and `/ui/NOTICE.txt` return the real texts; the
on-screen attribution line renders at `$FS-200` and its link resolves.

### ROLLBACK

The live image is **`fastbreak/service-ui:5.15.3-fb35`** (verified present locally and in use):

```
UI_IMAGE=fastbreak/service-ui:5.15.3-fb35 \
  docker-compose -p rp -f ~/Automation/fastbreak-platform/deploy/rp/docker-compose.yml \
  up -d --no-deps ui
```

Confirm with `docker inspect rp-ui-1 --format '{{.Config.Image}}'` → `fastbreak/service-ui:5.15.3-fb35`,
then reload `/ui/` and confirm the RP teal logo is back.

Rollback is instantaneous for **Phases 1-3 and 5** (overlay tags are immutable and all 35 prior tags
are still on disk). **Phase 4 additionally requires** the previous `fastbreak/service-ui-native:5.15.3`
image to be retained — **tag it before Phase 4** (`docker tag fastbreak/service-ui-native:5.15.3
fastbreak/service-ui-native:5.15.3-pre-rebrand`), or the fork-source rollback needs a full rebuild.

---

## 8. OPEN QUESTIONS

1. **Doc URLs.** §4's panel links to team docs. **Do these exist and are they reachable from the
   browser that loads `/ui/`?** If not, ship the shorter panel — do not ship placeholder links.
2. **Distribution.** Does FASTBREAK leave the organisation? Determines whether §4 obligations attach.
   Legal call, not mine.
3. **Attribution wording.** "Powered by ReportPortal" vs the descriptive form. I recommend descriptive;
   confirm.
4. **The icon.** Keep the play-arrow square (restated in `$ACCENT`) as the permanent app mark, or
   commission a real one? The interim wordmark does not depend on this.
5. **Email templates** in `service-api` still say ReportPortal. Separate repo, separate plan. Confirm
   whether transactional email is even enabled on this instance.
6. **Safari favicon.** The current `data:` SVG favicon is unverified in Safari. Phase 1's `.ico`
   supersedes it, but confirm `brand.js`'s icon-stripping does not remove the new `.ico` link too.
7. **`PolicyBlock`** only renders for `instanceType` `EPAM`/`SAAS`. Likely dormant here — confirm, and
   if dormant, drop it from scope rather than rebranding a hidden element.
