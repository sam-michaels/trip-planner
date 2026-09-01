---
name: Trip Planner
description: A multi-leg trip planner where the map and the list read as one document.
colors:
  bark-50: "#f6f7f2"
  bark-100: "#eaeee2"
  bark-200: "#d7dcc9"
  bark-300: "#bcc3aa"
  bark-400: "#9aa189"
  bark-500: "#7c836c"
  bark-600: "#616855"
  bark-700: "#4c5243"
  bark-800: "#363b30"
  bark-900: "#262a22"
  parchment: "#fcfdf8"
  moss-50: "#f0f5ee"
  moss-100: "#dfeadb"
  moss-200: "#c2d8bb"
  moss-300: "#9dbf94"
  moss-400: "#7aa36f"
  moss-500: "#5c8752"
  moss-600: "#486b40"
  moss-700: "#3a5534"
  moss-800: "#2e422a"
  ochre-50: "#faf5e8"
  ochre-100: "#f4ead0"
  ochre-200: "#e8d6a6"
  ochre-300: "#d9bd76"
  ochre-400: "#c9a34f"
  ochre-500: "#b0873a"
  ochre-700: "#6f5324"
  rust-50: "#fbf1ee"
  rust-200: "#e9c2b8"
  rust-400: "#c07361"
  rust-500: "#a85644"
  rust-600: "#8a4335"
  rust-700: "#6d352a"
  heather-50: "#f4f2f7"
  heather-300: "#b6aac7"
  heather-500: "#7d6a94"
  heather-600: "#645378"
  mode-flight: "#b5714f"
  mode-train: "#3f7d70"
  mode-bus: "#7d6a94"
  mode-car: "#a85644"
  mode-ferry: "#5b7f9e"
  mode-walk: "#7d8f4a"
  route-casing: "#ffffff"
typography:
  display:
    fontFamily: "Fraunces Variable, Georgia, Times New Roman, serif"
    fontSize: "1.25rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.008em"
    fontVariation: "SOFT 45, WONK 1, opsz 20"
  title:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.4
  caption:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.45
  micro:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.02em"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  full: "9999px"
spacing:
  hair: "4px"
  tight: "6px"
  snug: "8px"
  gutter: "12px"
  room: "16px"
components:
  button-primary:
    backgroundColor: "{colors.moss-700}"
    textColor: "#ffffff"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "6px 12px"
  button-primary-hover:
    backgroundColor: "{colors.moss-600}"
  button-primary-disabled:
    backgroundColor: "{colors.bark-300}"
    textColor: "#ffffff"
  button-ghost:
    textColor: "{colors.bark-600}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "6px 12px"
  button-ghost-hover:
    backgroundColor: "{colors.bark-200}"
  button-dashed:
    textColor: "{colors.bark-600}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
    padding: "10px 12px"
  input-text:
    backgroundColor: "{colors.parchment}"
    textColor: "{colors.bark-900}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "6px 10px"
  card-leg:
    backgroundColor: "{colors.parchment}"
    textColor: "{colors.bark-900}"
    rounded: "{rounded.xl}"
    padding: "8px 4px 8px 6px"
  status-pill-idea:
    backgroundColor: "{colors.heather-50}"
    textColor: "{colors.heather-600}"
    typography: "{typography.micro}"
    rounded: "{rounded.full}"
    padding: "2px 6px"
  status-pill-planned:
    backgroundColor: "{colors.ochre-50}"
    textColor: "{colors.ochre-700}"
    typography: "{typography.micro}"
    rounded: "{rounded.full}"
    padding: "2px 6px"
  status-pill-booked:
    backgroundColor: "{colors.moss-100}"
    textColor: "{colors.moss-700}"
    typography: "{typography.micro}"
    rounded: "{rounded.full}"
    padding: "2px 6px"
  popover:
    backgroundColor: "{colors.parchment}"
    rounded: "{rounded.xl}"
    padding: "12px"
    width: "320px"
  undo-bar:
    backgroundColor: "{colors.moss-800}"
    textColor: "{colors.parchment}"
    padding: "8px 12px"
---

# Design System: Trip Planner

## Overview

**Creative North Star: "The Field Notebook"**

This is a plan being written by hand, months before anything is booked. The
surface is parchment rather than white, the type is small and dense the way
handwriting in a margin is dense, and most of what is on screen is provisional —
dashed, faded, undated — because that is the honest state of a trip six months
out. The design's central job is to make an unfinished plan look like a plan
taking shape rather than a form someone failed to complete.

Everything in the palette is a colour something outdoors actually is — bark,
moss, ochre clay, rusted iron, heather, dry olive, slate water — desaturated
until none of them shout. The scheme divides cleanly: **chrome is pastel and
content is not.** Surfaces, borders and pills live at 50–200 so they read as
paper and shade; anything carrying meaning — a transport mode, a plan status, a
warning — sits at 400–600, dark enough to be told apart at a glance and to
survive being drawn 3px wide over a basemap.

The map is half the screen, so the map's conventions govern the whole app rather
than the other way around. A white casing under every route is the road-atlas
trick that makes a thin line legible over terrain; dashed-versus-solid is a
cartographic convention, not a decoration; and the basemap itself was chosen for
its restraint so six muted route colours would have somewhere to sit. The
itinerary list then borrows all of it, which is why someone who has looked at
the map for ten seconds already knows how to read the list.

The personality is real but rationed. Exactly one line in the interface — the
interlude under a connector — has a sense of humour, and it is deliberately the
faintest text on screen.

**Key Characteristics:**

- Paper, not white. Warm sage neutrals with a parchment float above them.
- Provisional by default. Dashed and faded is the resting state, not an error state.
- Every fact gets exactly one channel, and channels never borrow each other's.
- Compressed type scale: everything lives between 10px and 16px.
- Nearly flat. Depth comes from tone; shadow is a response to state.
- Character lives in the smallest text, never in ornament.

## Colors

Six named families, all desaturated, split by job: one neutral to build on, one
primary, three semantic, and a separate set that belongs to the map.

### Primary

- **Moss** (`moss-500` `#5c8752`, deepening to `moss-800` `#2e422a`): the
  settled, affirmative green. It owns focus rings (`moss-500`), the primary Save
  button (`moss-700`, hovering to `moss-600`), the "booked" status, the editor's
  own tinted surface (`moss-50/40`), and the undo bar (`moss-800`). Moss means
  *this is decided*.

### Secondary

- **Ochre** (`ochre-500` `#b0873a`, text at `ochre-700`): dry grass. The
  "here's something to do about it" tone — invitations, in-progress plans, soft
  warnings, and the drop indicator during a drag (`ochre-400`). Also the active
  border on an open place picker (`ochre-400` with an `ochre-100` ring).
- **Heather** (`heather-500` `#7d6a94`): the one cool colour in the scheme,
  reserved for "idea".

### Tertiary

- **Rust** (`rust-500` `#a85644`, text at `rust-600`/`rust-700`): oxidised iron,
  and the only alarm colour in the system. Muted like everything else, but the
  warmest thing on screen, which is what lets a hard gap be found in a list of
  pastels. Used for a broken itinerary and for destructive actions.

### Neutral

- **Bark** (`bark-50` `#f6f7f2` → `bark-900` `#262a22`): a sage-grey rotated off
  warm-grey toward green, so the app has a temperature without looking tinted.
  The ramp splits at 600. **Below it is surface**: `bark-100` is the page
  ground, `bark-200` every hairline border, `bark-300` dashed borders,
  `bark-500` decorative icons. **From 600 up is text**: `bark-600` tertiary and
  the quietest prose, `bark-700` secondary and field labels, `bark-800`–`900`
  primary.
- **Parchment** (`#fcfdf8`): the surface for anything that floats above the
  page — cards, the header, the itinerary header, popovers. Deliberately not
  `#ffffff`; a pure white card on a warm ground reads as a hole.

### Map palette

Six mode colours, each a colour something outdoors actually is, held at a common
depth and spread around the wheel so no mode looks more important than another:
terracotta (flight), pine-teal (train), heather (bus), rust (car), slate water
(ferry), dry olive (walk). They are the darkest things in the scheme on purpose —
they have to survive being drawn 3px wide over a basemap under a white casing,
where a pastel line disappears. A pure white casing (`#ffffff`) sits under every
route; it is the only pure white in the system and it is structural, not a
surface.

### Named Rules

**The Chrome-and-Content Rule.** Chrome is pastel; content is not. Surfaces,
borders and pills come from the 50–200 range. Anything that carries meaning — a
mode, a status, a warning — comes from 400–600. A border at 500 or a status
colour at 100 both break the scheme.

**The Two Channels Rule.** Mode and status get separate palettes and never share
a swatch. Status is a property of the plan, not of the journey, so it is the
same three colours on every row — that is the entire reason a reader can sweep
the list and count what is still unbooked. The status pill was once painted in
the mode colour, which made "Idea" terracotta on the flight and pine on the
train, and made the count impossible.

**The Ideas-Aren't-Grey Rule.** `idea` is heather, not grey. An idea is the most
alive thing in the list — the part of the trip still full of possibility — and
greying it out made a half-sketched itinerary look like a failure state. The
progression heather → ochre → moss runs cool to warm to settled.

**The Text Floor Rule.** No text is painted above `bark-600`. On parchment,
`bark-400` measures 2.6:1 and `bark-500` measures 3.9:1 — both below the 4.5:1
this product is committed to, and `bark-500` is the trap, because it looks like
the safe middle step and is not. This applies to placeholders and loading
states too: text someone has to read to know what a field wants is text. The
mode colours are also below the floor as text (3.0:1–4.4:1) — they were drawn
to survive as 3px lines over a basemap, not to be read at 13px, so they colour
routes, dots and chips, never a string.

**The One Alarm Rule.** Rust is the only alarm colour, and it is spent only on a
genuinely broken itinerary or a destructive action. A soft gap — arriving at an
airport and leaving from a downtown station — is the normal shape of a trip and
is drawn in ochre as an offer. Painting normal things red is how people learn to
ignore the red things that matter.

> **Known collision, to resolve rather than propagate.** Two mode colours are
> currently identical to semantic tokens: `mode-bus` is `heather-500`, the same
> value as the `idea` status, and `mode-car` is `rust-500`, the alarm colour.
> Both violate The Two Channels Rule and The One Alarm Rule as literally as they
> can be violated. Do not add a seventh mode by reaching further into the
> semantic ramps; give the bus and car modes their own hues when the palette is
> next revisited.

## Typography

**Display Font:** Fraunces Variable (with Georgia, then Times New Roman)
**Body Font:** the system sans stack (`ui-sans-serif, system-ui, sans-serif`)
**Numerals:** `tabular-nums` on every figure that can change — costs, totals,
the rate table.

**Character:** two voices with one job each. The interface speaks in system
sans — unbranded, native, and dense — and Fraunces speaks only for the trip
itself. Fraunces is set with `SOFT 45` and `WONK 1`, the two axes that round its
terminals and cant its alternates; without them it is a competent book serif,
and with them it reads as *written*, which is the whole reason The Field
Notebook chose it. `opsz 20` matches the size it is actually set at, so the
display role gets the drawing intended for it rather than the 14pt default.

The scale is compressed on purpose — 11px to 20px — which is what lets a leg
card hold six facts in two lines without any of them shouting. Hierarchy is
made from weight, colour and case far more than from size. Every role is a
named token carrying its own line-height and expressed in `rem`, so the
browser's font-size setting scales the whole interface proportionally.

### Hierarchy

- **Display** (Fraunces, 500, 1.25rem / 20px, 1.2, -0.008em): the trip's name
  and the empty states. Three places in the entire app, listed in the rule
  below.
- **Title** (600, 1rem / 16px, 1.3): data that has to be read exactly. The trip
  total, and nothing else.
- **Body** (400, 0.9375rem / 15px, 1.45): the working size — form fields,
  buttons, a leg's endpoints (at 500).
- **Label** (500, 0.8125rem / 13px, 1.4): field labels, counts, the currency
  table, the connector headline. Read as a label, not as prose.
- **Caption** (400, 0.75rem / 12px, 1.45): supporting lines — the leg card's
  meta row, the connector's note and detail, the interlude (italic).
- **Micro** (500, 0.6875rem / 11px, 1.2, +0.02em): status pills and the
  uppercase section labels. The floor of the system; nothing is smaller.

### Named Rules

**The Two Voices Rule.** Fraunces appears in exactly three places: the trip
title, the itinerary's empty state, and the map's setup state. It is for the
trip and for the moments the app has nothing to show but its own voice. It never
sets a label, a control, a value, or anything in a row that repeats. If a fourth
use is proposed, the question to answer first is which of the three it is
joining.

**The Named Role Rule.** Type is set with a role token — `text-body`,
`text-caption` — never a raw size. An arbitrary Tailwind size (`text-[11px]`)
sets a font-size and lets the leading fall through from whatever parent is
above it, which is how twelve elements in this app ended up led by a container
sized for something else. A new size means a new role, or it means the existing
role was right.

**The Rem Rule.** Every role is expressed in `rem`. Mixing rem roles with px
roles meant a reader who had turned their text size up got some of the
interface enlarged and the smallest, most in-need parts of it left exactly
where they were.

**The Quietest Voice Rule.** Personality lives in the smallest, faintest text in
its container, and never shares space with an alert. The interlude — the app's
one joke — is 12px, `bark-600`, italic, and is suppressed entirely on a hard
gap, because a joke under a warning is how a warning becomes wallpaper. Any
future flourish inherits both halves of this rule. Quiet is made from size,
weight and italic; it is never made from a grey too light to read.

**The Nothing-Is-Blank Rule.** An empty value is written out, never left as an
empty row. A leg with no date reads "No date or operator yet"; an unreachable
duration reads "crosses time zones". A blank looks broken; a named absence is an
invitation.

## Layout

A two-pane shell inside a full-height flex column: a fixed header, then the
itinerary list and the map side by side.

- **Header** — `shrink-0`, parchment, `bark-200` bottom border, `16px`
  horizontal / `10px` vertical padding. Trip title left, cost summary right,
  separated by a flexible spacer.
- **Panes** — at `lg` (1024px) and above, the itinerary is a fixed `27rem`
  (432px) sidebar with a right border and the map takes the remaining width.
  Below `lg` the container flips to `flex-col-reverse`, putting the map on top
  visually while keeping the itinerary **first in the DOM**, so keyboard and
  screen reader users reach the thing they came to edit before the map. The map
  then takes a fixed `45vh` and the list takes the rest.
- **List rhythm** — `12px` padding around the scroll region, `4px` between
  cards, and the connector strip supplying its own vertical space between them.
  The list scrolls independently; the header and the undo bar do not.
- **Spacing scale** — a 4px base used at 4 / 6 / 8 / 12 / 16px. `12px` is the
  standard gutter; `16px` is the largest gap anywhere in the app.

Density is high and intentional. A leg card is roughly 64px tall and carries
mode, endpoints, status, date, duration, operator, notes and cost, because the
whole point of the panel is to see the shape of an entire trip without
scrolling.

### Named Rules

**The DOM-Order Rule.** Visual order may be rearranged responsively, but the
itinerary always precedes the map in source order. Any future reflow must
preserve that.

## Elevation & Depth

The system is nearly flat and gets its depth from tone: a `bark-100` ground with
`parchment` surfaces floating on it, separated by `bark-200` hairlines. This is
where the design currently sits rather than a settled doctrine, and a richer
elevation scale is open for later — but the vocabulary today is small and worth
keeping small.

### Shadow Vocabulary

- **State lift** (`box-shadow: 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1)` — Tailwind
  `shadow-sm`): applied only to a *selected* leg card and to the selected mode
  and status chips in the editor. It marks state, never rest.
- **Overlay** (`box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px
  rgba(0,0,0,0.1)` — Tailwind `shadow-lg`): the cost breakdown popover and the
  onboarding dialog surface — the two things in the app that float over
  content, one inline in the document, one in the browser's top layer. The
  dialog is `parchment`, the card scale's `12px` radius (see Shapes), and this
  same shadow; it is a card, not a new kind of surface.
- **Scrim** (`::backdrop { background: rgba(38, 42, 34, 0.5) }` — `bark-900` at
  50%): the dimming layer behind the onboarding dialog. `bark-900` keeps it in
  the system's own neutral rather than a generic black, and 50% is chosen so
  the map reads *behind glass* — its colour and shapes still recognisable, no
  detail worth competing with the dialog for attention.
- **Selection ring** (`box-shadow: 0 0 0 3px <mode colour>26`): a 3px ring in
  the selected leg's own mode colour at 15% alpha, paired with a border in the
  same colour at full strength.
- **Map halo** (`line-width: 16, line-blur: 3, line-opacity: 0.5`, in the leg's
  own colour): the selected route's glow, above the casing so the route lights
  up rather than a second route appearing beneath it.

### Named Rules

**The Selection-Is-Colour Rule.** Selection is expressed as the selected item's
*own* mode colour — a ring on the card, a halo on the map — not as a generic
highlight. That is what makes a row and a line find each other across the two
panes.

**The Stacking Order Rule.** Four things stack, low to high: the map with its
in-map controls (including the motion control), the cost breakdown popover
above it, the onboarding dialog's scrim above that, and the dialog surface
above the scrim. The first two are ordinary document stacking, and a future
overlay with a high enough z-index could in principle sit over the popover.
The last two cannot be outranked that way: a native `<dialog>` opened with
`showModal()` renders in the browser's top layer, above every ordinary z-index
by construction, so the dialog and its scrim are always above the popover
regardless of what the popover claims. This is not a general elevation scale —
these are the four things that currently stack, named in the order they stack.

## Shapes

Soft, small radii throughout; nothing is sharp and nothing is a lozenge except
where a lozenge means something.

- **`12px` (`rounded-xl`)** — the card scale: leg cards, the inline editor, the
  cost popover, the empty state, the dashed "Add leg" button.
- **`8px` (`rounded-lg`)** — the control scale: buttons, inputs, selects, mode
  and status chips in the editor.
- **`6px` (`rounded-md`)** — controls inside the undo bar.
- **`4px` (`rounded`)** — inline tags, such as the airport code in the place
  picker.
- **Full round** — reserved for things that are *about* a single fact: the
  status pill, the mode chip on a card, the swap-endpoints button, and the
  connector dots.

Borders are hairlines at `bark-200`, moving to `bark-300` on hover. Dashed
borders at `bark-300` mark a container that is *waiting to be filled* — the
empty state and the "Add leg" button — which is the same grammar the status
system uses for a plan waiting to be firmed up.

### Named Rules

**The Dashed-Until-Booked Rule.** Dashed means provisional and solid means
committed, in every place the distinction can be drawn: the route on the map
(`[3, 2.5]` dash array vs. solid), the status pill's border, the mode chip on a
card (dashed outline and 8%-alpha fill until booked, then filled solid with the
mode colour), and the status buttons in the editor. Opacity reinforces it —
`0.72` for idea, `0.86` for planned, `1` for booked — deliberately raised from
an earlier `0.45/0.75/1`, where an idea faded almost to nothing and a trip made
mostly of ideas looked washed out.

**The Seam, Not a Line.** The space between two legs is drawn as a run of
translucent dots that swells in the middle and tapers at both ends — the shape
of a stitched seam. A solid line would say "these are joined," and the entire
point of that strip is that they are not: there is time, and sometimes a missing
journey, in between. The run's length scales with how long you are there.

## Components

The character to hold across all of them: **tactile and paper-like.** These are
things on a desk — visible edges, warm fills, a slight give on interaction —
rather than flat regions of colour.

### Buttons

- **Shape:** control scale, `8px` (`rounded-lg`); the full-width dashed
  affordances use the card scale, `12px`.
- **Primary:** `moss-700` fill, white text, `6px 12px`. Hover lifts to
  `moss-600`; disabled drops to `bark-300` with `cursor-not-allowed`.
- **Ghost:** `bark-600` text on no fill, hover to `bark-200` at 70%.
- **Dashed / add:** a `bark-300` dashed border, `bark-600` text, hovering to a
  `bark-400` border with a parchment fill and `bark-900` text.
- **Icon-only:** `bark-300`/`bark-400` at rest, darkening on hover; destructive
  icon buttons tint toward `rust-50` / `rust-600`.
- **Focus:** every interactive element takes `focus-visible:ring-2` in
  `moss-500`, with `ring-inset` where the control's own edge is flush against a
  card. Contextual controls ring in their own tone instead (ochre inside an
  invitation, rust inside an alert, white inside the moss undo bar).

### Chips

- **Mode chip (on a card):** a `24px` full-round chip in that mode's colour —
  dashed outline over an 8%-alpha fill while unbooked, filled solid with a
  parchment glyph once booked. Colour and icon both say "mode": the icon is what
  you read at arm's length, the colour is what picks one route out of four
  crossing routes at country zoom.
- **Status pill:** full-round, 10px medium, the same three colours on every row.
  Idea and planned carry a *dashed* border over a 50-level fill; booked is
  solid over a 100-level fill.
- **Mode / status chips (in the editor):** transparent-bordered and `bark-600`
  at rest; on selection they take that mode's or status's colour as text and
  border over a ~6–8% fill. Selecting previews exactly how the map and the card
  will draw it, so the editor doubles as the legend for both channels.

### Cards / Containers

- **Corner Style:** `12px`.
- **Background:** `parchment` on the `bark-100` ground.
- **Border:** `bark-200` hairline, `bark-300` on hover.
- **Selected:** border and a 3px ring in the leg's own mode colour, plus
  `shadow-sm`. See Elevation.
- **Dragging:** the source card drops to 40% opacity; the drop target is a
  `2px` full-round `ochre-400` bar between cards.
- **Internal padding:** `8px` vertical with a tight `6px` left gutter, so the
  grip handle sits close to the edge; supporting lines indent to `44px` to align
  under the title rather than under the chip.

### Inputs / Fields

- **Style:** `parchment` fill, `bark-200` hairline, `8px` radius, `6px 10px`
  padding, 14px text, `bark-600` placeholder.
- **Focus:** border shifts to `moss-400` with a soft `moss-100` ring — a tint,
  not a glow.
- **Label:** 12px medium `bark-600`, `4px` above the control, wrapping the input
  in a `<label>` rather than pairing by id.
- **Numeric fields** carry `tabular-nums`.

### Navigation

There is no site navigation. The app is a single shell; movement happens by
selecting a leg, which is a two-way binding between the list and the map rather
than a route change.

The onboarding dialog does not change that. It is a native `<dialog>` that
opens once, on load, and asks three questions — where you are, where you want
to go, how you'd reach the airport — over a shell that stays visible and live
behind it. It is not a route and it is not a step in a flow: there is nowhere
it takes you, and closing it does not navigate anywhere, it just stops asking.
The map and the list are exactly the same map and list once it is gone.

### Named Rules

**The One Modal Rule.** The onboarding dialog is the only modal in the app,
and it is not a pattern to reach for again. It exists because it is the one
question the app has to ask before the shell means anything, and it asks it
exactly once. A second modal would need its own version of that justification
— a task that cannot be answered inline in the list or the map, that has to
interrupt rather than wait its turn, and that is asked once rather than
repeated on every visit. Short of all three, a new dialog is a sign that
something belongs in the shell instead. See Elevation & Depth for the scrim
and the stacking order this one rule introduces.

**The Modal Contract Rule.** A modal dialog owns focus while it is open: focus
moves into it when it opens, stays inside it while it is open, and returns to
whatever was focused before it opened when it closes. `Escape` closes it. Its
scrim is decorative — it exists to be seen, not read — so it carries no role
or text of its own; every word the dialog has to say is inside it. WCAG 2.2 AA
is binding across this app (see `PRODUCT.md`), and a dialog is the easiest
place to break that promise by accident, because the browser supplies some of
this for free and the eye cannot tell which part that was.

### Signature: the connector strip

The strip between two legs is the spine of the list and always says something,
because that space is where the trip actually happens — three nights in Lisbon
is the point of going to Lisbon; the flight is just how you got there. It runs
in three tones: **quiet** (the mode colour of the leg you arrived on, for time
in a place), **invite** (ochre, for a same-city transfer that needs adding), and
**alert** (rust, for an itinerary that does not connect). Four stacked lines at
most: headline, stay note, interlude, route detail — with the interlude
suppressed in the alert tone.

### Signature: the route on the map

Five layers over one GeoJSON source, bottom to top: an invisible 20px hit line
so a 3px route is a real touch target, a `7px` white casing, a `16px` blurred
selection halo, and the dashed and solid line pair split by status. Above them,
on a source of their own, the vehicles.

### Signature: the vehicle on the line

One vehicle per route, in that leg's mode and colour, departing A and arriving
B on a loop. It replaced a static mode icon stamped along the line every
`130px`, which said what kind of journey a line was but never which way it
went — nothing on the map distinguished Porto → Lisbon from Lisbon → Porto.
A run departs, travels, arrives, holds at B for the last sixth of its cycle,
and fades; it does not wrap straight back to the start, because a journey that
teleports home reads as a stutter rather than a second trip. Pace is by ground
distance, clamped to `4s`–`14s`, so a walk across a city is not glacial and an
ocean crossing is not a blur. Runs are phase-offset from the leg's id so the
map is not a parade.

### Named Rules

**The Moving Heading Rule.** A vehicle drawn from above may be turned to face
where it is going; one drawn head-on or in side elevation may not. The plane
and the footprints are plan views and take their bearing. The train, ship, bus
and car are elevations — turning a side-view car to a westward heading drives
it along upside down — so they stay upright even when the compass turns the
map. This overturns the old rule that icons never rotate, and the reason it can
be overturned is motion: a *stationary* tilted plane reads as falling, and a
*moving* one reads as a heading. Rotation without movement is still banned.

**The Stoppable Motion Rule.** Any motion that starts on its own and loops is
seeded from `prefers-reduced-motion` and carries a visible control that stops
it. WCAG 2.2 SC 2.2.2 asks for a mechanism in the content, reachable by someone
who has never opened their OS accessibility settings, and the media query alone
is not that. When motion is held off, the vehicles park at their midpoints
rather than disappearing — a resting map still shows one icon per route.

**The Selection-Is-Size Rule.** Where selection has to be marked on something
already carrying status opacity, it is marked by size and full strength, never
by dimming everything else. The unselected vehicles sit at their own line's
opacity, which for an idea is `0.72` — the floor below which nothing unbooked
may be faded. Dimming the rest to make one stand out would have broken the one
rule protecting ideas from looking like failures.

## Do's and Don'ts

### Do:

- **Do** keep chrome in the 50–200 range and meaning in 400–600. A new surface
  is bark; a new confirmation is moss; a new invitation is ochre.
- **Do** give every new fact its own channel, and check it does not collide with
  mode, status or selection before choosing how to draw it.
- **Do** draw provisional things dashed and committed things solid, in every
  medium — pill, chip, map line, editor control.
- **Do** name an absence in words rather than leaving a row blank.
- **Do** put focus rings on everything interactive, in `moss-500` by default and
  in the local tone inside a coloured container.
- **Do** keep new type inside the 11–20px scale, set it with a named role token
  rather than a raw size, and build hierarchy from weight, colour and case.
- **Do** keep text at `bark-600` or darker, and check a new colour as text
  before using it as text.
- **Do** give every map-driven action a keyboard and list equivalent; the
  itinerary list is the non-visual equivalent of the map.
- **Do** use `parchment` for anything floating and `bark-100` for the ground.
- **Do** give looping motion an off switch and a `prefers-reduced-motion`
  default, and park what was moving rather than removing it.

### Don't:

- **Don't** use pure white as a surface. `#ffffff` exists in this system for
  exactly one thing: the casing under a route.
- **Don't** grey out an idea, or fade an unbooked item below `0.72` opacity. A
  trip made mostly of ideas is every trip worth planning, and it must not look
  like a failure state.
- **Don't** make text quiet by making it light. Quiet is size, weight and
  italic; `bark-400` prose is not subtle, it is unreadable.
- **Don't** set a raw pixel size (`text-[11px]`). It carries no line-height and
  no rem scaling.
- **Don't** put Fraunces on a label, a control, a value, or anything in a
  repeating row.
- **Don't** let status borrow a mode colour, or a mode borrow a semantic one.
  Two existing collisions are documented under Colors as debts, not precedent.
- **Don't** spend rust on anything that is not genuinely broken or genuinely
  destructive. A soft gap is an offer in ochre.
- **Don't** add a resting shadow. Shadow marks selection, focus or an overlay.
- **Don't** put personality anywhere but the quietest text in its container, and
  never beside a warning.
- **Don't** drift toward the greyscale, near-black pass this palette replaced —
  legible and completely joyless.
- **Don't** drift toward a saturated SaaS dashboard: bright blue primaries, hard
  white cards, dense chrome.
- **Don't** borrow anything from consumer travel-booking sites — urgency
  banners, deal badges, countdowns, red sale accents. This is a planning tool,
  and nothing in it should push a decision.
- **Don't** add gradients, blobs, mascots or illustration. Character comes from
  the palette, the map and one line of quiet prose.
- **Don't** rotate an icon that isn't moving, or rotate one drawn head-on or in
  side elevation at all. A tilted stationary plane reads as a crash.
