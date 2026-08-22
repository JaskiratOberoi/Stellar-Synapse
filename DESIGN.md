---
name: Stellar Synapse
description: A quiet graphite control room for lab instrument interfacing — status legible from across the room.
colors:
  graphite-ground: "hsl(220 9% 5%)"
  graphite-plate: "hsl(220 8% 8%)"
  graphite-overlay: "hsl(220 8% 7%)"
  graphite-well: "hsl(220 7% 12%)"
  graphite-field: "hsl(220 7% 13%)"
  graphite-mist: "hsl(220 6% 14%)"
  ink: "hsl(216 12% 92%)"
  ink-muted: "hsl(218 8% 64%)"
  moonlight: "hsl(216 14% 93%)"
  hairline: "hsl(218 10% 88%)"
  sage: "hsl(140 14% 72%)"
  signal-green: "hsl(145 58% 46%)"
  signal-amber: "hsl(32 92% 56%)"
  signal-red: "hsl(4 74% 56%)"
typography:
  display:
    fontFamily: "Urbanist, Segoe UI, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 200
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  display-number:
    fontFamily: "Urbanist, Segoe UI, system-ui, sans-serif"
    fontSize: "3.75rem"
    fontWeight: 200
    lineHeight: 1
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Urbanist, Segoe UI, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 500
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Urbanist, Segoe UI, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    letterSpacing: "0.01em"
  microlabel:
    fontFamily: "Urbanist, Segoe UI, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    letterSpacing: "0.14em"
  mono:
    fontFamily: "Cascadia Code, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
rounded:
  sm: "calc(1.25rem - 8px)"
  md: "calc(1.25rem - 4px)"
  lg: "1.25rem"
  plate: "1.5rem"
  pill: "9999px"
spacing:
  gutter: "1.25rem"
  card: "1.5rem"
  control-gap: "0.5rem"
components:
  button-primary:
    backgroundColor: "{colors.moonlight}"
    textColor: "hsl(220 9% 8%)"
    rounded: "{rounded.pill}"
    height: "40px"
    padding: "0 1.25rem"
  button-secondary:
    backgroundColor: "{colors.graphite-well}"
    textColor: "hsl(216 12% 88%)"
    rounded: "{rounded.pill}"
    height: "40px"
    padding: "0 1.25rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.pill}"
    height: "40px"
    padding: "0 1.25rem"
  badge:
    rounded: "{rounded.pill}"
    padding: "0.25rem 0.625rem"
  input:
    backgroundColor: "{colors.graphite-field}"
    textColor: "{colors.ink}"
    rounded: "1rem"
    height: "40px"
    padding: "0 1rem"
  card:
    backgroundColor: "{colors.graphite-plate}"
    rounded: "{rounded.plate}"
    padding: "1.5rem"
---

# Design System: Stellar Synapse

## Overview

**Creative North Star: "The Graphite Control Room"**

Stellar Synapse is a desktop-only Electron operator console rendered as a quiet, near-black control room. Everything at rest is graphite: the ground, the plates, the controls, even the charts. Color is rationed to a single job — connection and pipeline status (green flowing, amber trying, red broken) plus one soft sage highlight for "armed and listening" states and accents. The direction contract explicitly refuses the boxed sidebar-admin template and the glowing-gradient dashboard, and the build follows through: navigation is a top pill rail, cards are soft 24px-radius plates with hairline edges, and the loudest thing on any screen is an ultralight display numeral you can read from across the lab.

The tone is calm competence. Interactive surfaces lighten instead of lifting; edges are foreground-tinted hairlines, never solid strokes; frosted glass is spent exactly once, on the modal layer. A daylight variant (`.light` class) re-points the same tokens to a bright bench palette without changing any of the logic — one monochrome system, two exposures.

**Key Characteristics:**
- Near-black graphite ground with tonal plate layering; shadow used only under hero plates
- Color is status semantics only (green/amber/red) plus one sage accent
- Every control is a pill; every card is a soft large-radius plate
- Ultralight (weight 200) tabular display numerals; wide-tracked uppercase micro labels
- Monochrome hairline charts drawn in `currentColor` with dashed reference targets
- Fonts bundled locally — the app must render identically on offline lab PCs

## Colors

A graphite monochrome ramp carries the entire interface; chromatic color exists only as status signal. All tokens live as raw HSL triplets in `globals.css` (`--background`, `--card`, …) with alpha applied at use sites; the values below are the canonical dark-theme set, with the light theme re-pointing the same variables.

### Primary
- **Moonlight** (hsl(216 14% 93%), ≈ #EBEDF0): the primary action color is a *light fill*, not a hue — the filled pill button. Its text is near-black graphite. In the light theme it inverts to near-black ink with light text.

### Secondary
- **Sage** (hsl(140 14% 72%), ≈ #AEC2B4): the one non-status tint. Used sparingly: the "Listening" status state, the mapped/queued pipeline stages, the text caret, and occasional accent chips. Never used as a brand wash.

### Neutral
- **Graphite Ground** (hsl(220 9% 5%), ≈ #0C0D0E): the app background.
- **Graphite Plate** (hsl(220 8% 8%), ≈ #131416): card surfaces.
- **Graphite Overlay** (hsl(220 8% 7%), ≈ #101113): popover/frost base, at 0.82 alpha under blur.
- **Graphite Well** (hsl(220 7% 12%), ≈ #1C1E21): secondary fills — inactive-control pills, hover tints, nested tiles (often at /40–/60 alpha).
- **Graphite Field** (hsl(220 7% 13%), ≈ #1E2023): input and select fills.
- **Graphite Mist** (hsl(220 6% 14%), ≈ #222326): muted fills, skeleton base.
- **Ink** (hsl(216 12% 92%), ≈ #E8EAED): foreground text.
- **Ink Muted** (hsl(218 8% 64%), ≈ #9CA1AB): secondary text, axis ticks, metadata.
- **Hairline** (hsl(218 10% 88%) at `--border-alpha` 0.08 dark / 0.10 light): the only border color. The alpha is folded into the Tailwind `border` token itself, so `border-border` *is* the hairline.

### Status (functional, not decorative)
- **Signal Green** (hsl(145 58% 46%), ≈ #31B96A): online, written, healthy.
- **Signal Amber** (hsl(32 92% 56%), ≈ #F69628): connecting, skipped, suppressed, mock mode.
- **Signal Red** (hsl(4 74% 56%), ≈ #E2473C): error, offline attention, destructive actions.

### Named Rules
**The Status-Only Rule.** Chromatic color appears only as status semantics (green/amber/red) plus the single sage accent. If an element is not communicating state, it is graphite. Status fills are always low-alpha tints (`/15` background with full-strength text), never saturated blocks.

**The Hairline Rule.** Every border is the foreground-tinted hairline at `--border-alpha` (8% dark, 10% light). No solid strokes, no tinted borders on chips — edges stay quiet; hover may double the alpha, nothing more.

## Typography

**Display & Body Font:** Urbanist variable (weight axis 100–900), falling back to Segoe UI / system-ui
**Data/Mono Font:** Cascadia Code, falling back to Consolas

**Character:** One geometric sans does everything from ultralight hero numerals to 600-weight micro labels; the contrast comes entirely from weight and tracking, not from mixing families. Both Urbanist files (`urbanist-var.woff2`, italic) are bundled at `src/renderer/src/assets/fonts` — never runtime-loaded, because lab PCs may be offline.

### Hierarchy
- **Display** (200 extralight, 2.25rem/text-4xl, tracking-tight): page headlines via `PageHeader`; the page introduces itself, the chrome does not. Modal titles use the same voice at text-2xl.
- **Display Number** (`.display-number`: weight 200, tabular-nums, letter-spacing -0.01em, line-height 1): hero count numerals at text-6xl on Dashboard plates, text-2xl for inline stats. Tabular so live counters don't jitter.
- **Title** (500 medium, 15px, tracking-tight): card titles (`CardTitle`) and the app name.
- **Body** (400, 15px base with 0.01em tracking): default UI text; secondary copy drops to text-sm muted.
- **Microlabel** (`.microlabel`: 600, 11px, 0.14em tracking, uppercase, muted color): the metadata voice — form labels, table heads, stat captions, pipeline stage names.
- **Mono** (Cascadia/Consolas, 11–12px): machine data only — sample IDs, IP addresses, timestamps, raw frames, version strings.

### Named Rules
**The Mono-Only-For-Data Rule.** Monospace is reserved for machine-originated data (IDs, IPs, timestamps, frames, versions). UI copy, labels, and headings are always Urbanist.

**The Weight-Is-Hierarchy Rule.** Scale jumps pair with weight drops: the bigger the type, the lighter it gets (text-6xl at weight 200; 11px labels at weight 600). Never a bold headline.

## Layout

Desktop-only Electron window; no mobile breakpoints. The shell is a 72px top bar (logo, pill nav rail, status chips, theme toggle) over a scrollable page body; `body` itself is `overflow: hidden` and panes manage their own scroll. Pages compose from a `PageHeader` (headline left, actions right, on the same baseline) followed by a plate grid.

- **Rhythm:** the page-level gap is 1.25rem (`gap-5` / `space-y-5`); card internal padding is 1.5rem (`p-6`, headers `pb-3`, content `pt-0`); control gaps are 0.5rem.
- **Dashboard grammar:** left two-thirds stacks stat plates over a full-width chart plate; right third is a live feed rail (`lg:grid-cols-3`). Horizontal pill rails (`flex flex-wrap gap-2`) list instruments.
- **Rows and tiles:** list rows are `rounded-2xl px-3 py-2` with `hover:bg-secondary/60`; nested tiles inside plates use `rounded-2xl bg-secondary/40`. Table heads are microlabels, not styled `<th>` chrome.
- **Density:** operator-console dense — small type, tight rows — but breathing room comes from the 24px plate padding and 20px gutters, not from whitespace-heavy hero sections.

## Elevation & Depth

Depth is tonal, not shadowed. The graphite ramp (ground → plate → well → mist) does the layering; ordinary cards (`.surface`) carry no shadow at all, only the hairline edge. Exactly two exceptions exist:

### Shadow Vocabulary
- **Raised plate** (`.surface-raised`: `box-shadow: 0 24px 48px -24px hsl(220 40% 2% / 0.7)` plus a subtle top-to-bottom card gradient): reserved for the hero stat plates — the two counts that matter at across-the-room scale.
- **Modal frost** (`.frost`: popover at 0.82 alpha, `backdrop-filter: blur(20px) saturate(1.1)`, 1.5× hairline, plus `shadow-2xl shadow-black/50` on the dialog): the one place glass is spent. The scrim behind it is `bg-background/70 backdrop-blur-md`.

### Named Rules
**The Lighten-Don't-Lift Rule.** Interactive plates respond by lightening (`.surface-hover` → secondary fill, hairline alpha doubled) — no translate, no scale-up, no hover shadow. Calm, no parallax.

**The One-Glass Rule.** Frosted glass (`.frost`) is reserved for the modal/command layer. Page surfaces are opaque graphite.

## Shapes

The form language is soft and continuous: plates and pills, nothing square. Card plates sit at 24px radius (`.surface`, `rounded-3xl`), inputs and nested tiles at 16px (`rounded-2xl`), and every control — buttons, badges, nav items, chips, switch, scrollbar thumb — is a full pill (`rounded-full`). The radius scale hangs off `--radius: 1.25rem` (lg), stepping down 4px per size. Icons are lucide stroke icons at a consistent `strokeWidth={1.75}`, mostly 16–20px; no filled glyphs.

**The Pill Rule.** If it can be clicked, it is a pill. Rectangular interactive elements do not exist in this system.

## Components

### Buttons
- **Shape:** full pill (`rounded-full`), font-medium, heights 32/40/44px (sm/md/lg), 36px square for icon buttons.
- **Primary:** the filled light pill — moonlight fill with near-black text; hover dims to 85% opacity fill.
- **Secondary:** graphite well fill, hover to mist. **Ghost:** transparent, muted text, hover gains a well fill. **Outline:** hairline border on transparent.
- **Danger / Success:** low-alpha tinted pills (`bg-destructive/15 text-destructive`, hover `/25`) — status fills only on explicit destructive/confirming actions.
- **States:** `active:scale-[0.98]` press; focus is a 2px `ring-ring/60` with 1px background offset; disabled is 50% opacity.

### Badges (chips)
- **Style:** pill, `px-2.5 py-1 text-xs font-medium`. Tinted fill only — never a tinted border. Tones: default (well fill), success/warning/danger (`/15` tint + toned text), accent (sage tint), muted, primary (`bg-primary/10`).

### Cards / Containers
- **Corner Style:** 24px (`.surface`).
- **Background:** graphite plate with hairline edge; hero plates use `.surface-raised` (gradient + soft drop shadow).
- **Hover:** opt-in `.surface-hover` (interactive cards only) — lightens per the Lighten-Don't-Lift Rule.
- **Internal Padding:** p-6; header pb-3, content pt-0.

### Inputs / Fields
- **Style:** soft filled — graphite field fill, transparent border, 16px radius, 40px height. Placeholder at muted/70. `Select` shares the exact classes (appearance-none).
- **Focus:** border warms to `foreground/25`, fill lifts to card, 2px `ring-ring/25`. Hover lightens to mist. No hard outlines until focus.
- **Labels:** always `.microlabel`.

### Switch
- **Monochrome state:** track goes full foreground when on (knob flips to background); off is mist track with foreground/80 knob. Spring-animated knob (stiffness 420, damping 32). No accent color spent on it.

### Navigation (top pill rail)
- 72px header; links are pills (`px-4 py-2 text-sm`). Inactive: normal weight, muted, hover to foreground — no fill. Active: medium weight with a shared-layout `bg-secondary` pill that springs between items (`layoutId` + spring). Right side carries hairline-bordered status chip pills (LIS, cloud) with 1.5px status dots.

### StatusDot (signature)
Status is the product: a 2px×2px dot plus a toned 12px label so state survives even where the dot is the only mark. Online = green (with ping halo), Listening = sage (ping), Connecting = amber (ping), Error = red (no ping), Offline = a deliberate hollow ring (1.5px muted border, transparent fill) — quiet but legible.

### Modal (the frosted command layer)
Centered dialog, `rounded-3xl` on `.frost`, max-w-lg, scale/rise entrance (0.32s, ease [0.22,1,0.36,1]) over a blurred scrim; extralight text-2xl title; footer actions behind a hairline top border. Escape closes.

### Charts (recharts)
Monochrome hairline charts: series stroke is `currentColor` at 1.5px with a 14%→0 gradient fill; grid is dashed `currentColor` at 8% opacity, horizontal lines only; axes have no lines or ticks, just 11px muted labels. Targets/averages are dashed `currentColor` ReferenceLines at 35% opacity. Tooltips are popover-filled, 16px radius, hairline-edged, styled inline with `hsl(var(--…))`. Color enters a chart only when the data itself is a status.

### Motion
All presets live in `src/renderer/src/lib/motion.ts`: short and gentle (`ease` 0.32s [0.22,1,0.36,1]; springs 420/32 and 260/26). Pages fade-rise 8px; grids stagger children at 0.06s; live-feed rows enter with `listItem` inside `AnimatePresence`. A global `prefers-reduced-motion` guard in `globals.css` collapses all animation.

## Do's and Don'ts

### Do:
- **Do** ration color by the Status-Only Rule — green/amber/red for state, sage as the lone accent, graphite for everything else.
- **Do** make every interactive element a pill and every card a 24px plate with a hairline edge.
- **Do** set hero numerals in `.display-number` (weight 200, tabular) and metadata in `.microlabel` (11px, 0.14em, uppercase).
- **Do** draw charts in `currentColor` hairlines with dashed reference targets and `hsl(var(--…))` inline styles so both themes work untouched.
- **Do** respond to hover by lightening the fill (`.surface-hover`, `hover:bg-secondary/60` rows); keep motion to the shared presets in `lib/motion.ts` and honor reduced-motion.
- **Do** keep all assets (fonts included) in the bundle — offline lab PCs are the operating floor.

### Don't:
- **Don't** introduce a boxed sidebar layout, gradient washes, or glow effects — the world refuses the sidebar-admin and glowing-dashboard templates.
- **Don't** use saturated color blocks; status fills are `/15` tints with toned text.
- **Don't** put solid or tinted borders on anything; the hairline (`border-border`) is the only edge.
- **Don't** lift, scale up, or shadow surfaces on hover; shadow exists only on `.surface-raised` hero plates and the modal.
- **Don't** use monospace for UI copy, or bold weights for headlines — data is mono, hierarchy is lightness.
- **Don't** spend frost outside the modal layer.
