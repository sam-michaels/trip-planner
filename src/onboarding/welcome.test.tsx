// ============================================================
// Rendered tests for the first-run popup.
//
// Same harness as `destinationPicker.test.tsx` — React's own `act`
// plus `createRoot`, no testing-library, per the rule in that file's
// header. The `<dialog>` shim in `src/test/setup.ts` supplies the
// modal methods jsdom lacks; it does NOT emulate focus containment or
// the top layer, so nothing here asserts on those. They are real
// browser behaviour and belong in a real browser.
//
// `detectLocation` is injected in EVERY test, and so are the two
// suggestion loaders on any test that reaches step 4 or 5. The suite
// must never reach the network and must never touch real geolocation.
// ============================================================

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Place } from "../model/trip";
import { coords } from "../model/trip";
import type { HomeLocationResult } from "../lib/homeLocation";
import type { ActivitySuggestion, StaySuggestion } from "../lib/poiApi";
import { Welcome } from "./Welcome";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function render(ui: React.ReactNode) {
  act(() => root.render(ui));
}

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

const LISBON: Place = {
  id: "lisbon",
  name: "Lisbon",
  city: "Lisbon",
  country: "PT",
  coords: coords(-9.1393, 38.7223),
};

const TORONTO: Place = {
  id: "toronto",
  name: "Toronto",
  city: "Toronto",
  country: "CA",
  coords: coords(-79.3832, 43.6532),
};

const never = () => new Promise<HomeLocationResult>(() => {});

function dialog(): HTMLDialogElement {
  return container.querySelector("dialog")!;
}

function buttonSaying(text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(text),
  );
}

const noop = () => {};

describe("Welcome", () => {
  it("opens as a modal and closes when `open` goes false", () => {
    const props = {
      onOrigin: noop,
      onDestination: noop,
      onDone: noop,
      detectLocation: never,
    };

    render(<Welcome open={false} {...props} />);
    expect(dialog().open).toBe(false);

    render(<Welcome open {...props} />);
    expect(dialog().open).toBe(true);

    render(<Welcome open={false} {...props} />);
    expect(dialog().open).toBe(false);
  });

  it("never asks for a location unless the button is pressed", async () => {
    // The whole reason `detectHomeLocation` is gated behind an explicit
    // action: this dialog opens ON page load, so detecting here would
    // be a permission prompt nobody asked for.
    const detectLocation = vi.fn(never);
    render(
      <Welcome
        open
        onOrigin={noop}
        onDestination={noop}
        onDone={noop}
        detectLocation={detectLocation}
      />,
    );

    expect(detectLocation).not.toHaveBeenCalled();

    click(buttonSaying("Use my location")!);
    expect(detectLocation).toHaveBeenCalledTimes(1);
  });

  it("takes a detected city as the origin and moves to step 2", async () => {
    const onOrigin = vi.fn<(place: Place) => void>();
    const detectLocation = async (): Promise<HomeLocationResult> => ({
      kind: "found",
      place: TORONTO,
    });

    render(
      <Welcome
        open
        onOrigin={onOrigin}
        onDestination={noop}
        onDone={noop}
        detectLocation={detectLocation}
      />,
    );

    await act(async () => {
      buttonSaying("Use my location")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(onOrigin).toHaveBeenCalledWith(TORONTO);
    expect(container.textContent).toContain("Where do you want to go?");
  });

  it("leaves typing available when permission is refused, and offers no retry", async () => {
    // "Denied" is not retryable — the same prompt would give the same
    // answer — so a retry button there is a lie. Typing must still work.
    const detectLocation = async (): Promise<HomeLocationResult> => ({
      kind: "denied",
    });

    render(
      <Welcome
        open
        onOrigin={noop}
        onDestination={noop}
        onDone={noop}
        detectLocation={detectLocation}
      />,
    );

    await act(async () => {
      buttonSaying("Use my location")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(buttonSaying("Try again")).toBeUndefined();
    expect(container.textContent).toContain("search for your city instead");
    // The field is still there to type into — never a dead end.
    expect(buttonSaying("Search for a place")).toBeDefined();
  });

  it("offers a retry for a failure that might succeed next time", async () => {
    const detectLocation = vi
      .fn<() => Promise<HomeLocationResult>>()
      .mockResolvedValueOnce({ kind: "no-fix" })
      .mockResolvedValueOnce({ kind: "found", place: TORONTO });

    const onOrigin = vi.fn<(place: Place) => void>();
    render(
      <Welcome
        open
        onOrigin={onOrigin}
        onDestination={noop}
        onDone={noop}
        detectLocation={detectLocation}
      />,
    );

    await act(async () => {
      buttonSaying("Use my location")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    const retry = buttonSaying("Try again");
    expect(retry).toBeDefined();

    await act(async () => {
      retry!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(detectLocation).toHaveBeenCalledTimes(2);
    expect(onOrigin).toHaveBeenCalledWith(TORONTO);
  });

  it("reports Escape as done rather than leaving React out of step", () => {
    // The element's own `close` event fires on Escape with no help from
    // React. Unhandled, the dialog would be shut while the app still
    // believed it was open — and nothing would ever reopen it.
    const onDone = vi.fn();
    render(
      <Welcome
        open
        onOrigin={noop}
        onDestination={noop}
        onDone={onDone}
        detectLocation={never}
      />,
    );

    act(() => {
      dialog().dispatchEvent(new Event("close"));
    });

    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("does not report done when the caller is the one closing it", () => {
    const onDone = vi.fn();
    const props = {
      onOrigin: noop,
      onDestination: noop,
      onDone,
      detectLocation: never,
    };

    render(<Welcome open {...props} />);
    render(<Welcome open={false} {...props} />);

    // `onDone` firing here would be the component telling the app
    // something the app just told it.
    expect(onDone).not.toHaveBeenCalled();
  });

  it("names itself for a screen reader", () => {
    render(
      <Welcome
        open
        onOrigin={noop}
        onDestination={noop}
        onDone={noop}
        detectLocation={never}
      />,
    );

    const labelledBy = dialog().getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toBe(
      "Where are you starting from?",
    );
  });
});

/** Step 1 answered via a detected fix — the one path with no network. */
async function atStepTwo(handlers: {
  onDestination?: (place: Place) => void;
  onDone?: () => void;
  stays?: readonly StaySuggestion[];
  activities?: readonly ActivitySuggestion[];
  chosenStayIds?: ReadonlySet<string>;
  onToggleStay?: (item: StaySuggestion, add: boolean) => void;
  onToggleActivity?: (item: ActivitySuggestion, add: boolean) => void;
}) {
  render(
    <Welcome
      open
      onOrigin={noop}
      onDestination={handlers.onDestination ?? noop}
      onDone={handlers.onDone ?? noop}
      detectLocation={async () => ({ kind: "found", place: TORONTO })}
      // Both default to empty, which is also the shape a city with
      // nothing tagged returns — so a test that doesn't care about
      // steps 4 and 5 still walks through them without a request.
      loadStaySuggestions={async () => handlers.stays ?? []}
      loadActivitySuggestions={async () => handlers.activities ?? []}
      chosenStayIds={handlers.chosenStayIds}
      onToggleStay={handlers.onToggleStay}
      onToggleActivity={handlers.onToggleActivity}
    />,
  );

  await act(async () => {
    buttonSaying("Use my location")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
  });
}

/** The Lisbon card in the destination grid, which answers step 2. */
function lisbonCard(): HTMLButtonElement | undefined {
  return [
    ...container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Add "]'),
  ].find((card) => card.getAttribute("aria-label")?.startsWith("Add Lisbon,"));
}

/**
 * Press a button and let the step that follows settle.
 *
 * `await act` rather than plain `click`, because steps 4 and 5 resolve
 * a promise on mount — even a stubbed loader lands a microtask later,
 * and asserting before it does sees the spinner.
 */
async function advance(label: string) {
  await act(async () => {
    buttonSaying(label)!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
  });
}

describe("Welcome, step 2", () => {

  it("emits the chosen destination and moves on rather than ending", async () => {
    // Step 3 asks how you reach the gateway, and whether there IS one
    // isn't known at this instant — the engine is still answering. So
    // the flow advances and the last step decides what it has to say.
    const onDestination = vi.fn<(place: Place) => void>();
    const onDone = vi.fn();
    await atStepTwo({ onDestination, onDone });

    click(lisbonCard()!);

    expect(onDestination).toHaveBeenCalledTimes(1);
    expect(onDestination.mock.calls[0][0].city).toBe(LISBON.city);
    expect(onDone).not.toHaveBeenCalled();
    // "Next", not "Start planning": step 3 stopped being the last
    // screen when the stay and activity questions landed behind it.
    expect(buttonSaying("Next")).toBeDefined();
    expect(buttonSaying("Start planning")).toBeUndefined();
  });

  it("finishes from the last step", async () => {
    const onDone = vi.fn();
    await atStepTwo({ onDone });

    click(lisbonCard()!);

    // 3 → 4 → 5. Each `Next` is a step, and only the fifth screen
    // offers the way out.
    await advance("Next");
    await advance("Next");
    click(buttonSaying("Start planning")!);

    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("asks nothing about the airport when there is direct service", async () => {
    // No gateway in the proposals means the engine made no choice on
    // the traveller's behalf, so there is nothing to hand back — the
    // step carries only the way onward.
    await atStepTwo({});

    click(lisbonCard()!);

    expect(container.querySelector('[role="radiogroup"]')).toBeNull();
    // And the counter stays honest: five screens either way, rather
    // than the "Step 3 of 2" a conditional total produced.
    expect(container.textContent).toContain("Step 3 of 5");
  });
});

describe("Welcome, steps 4 and 5", () => {
  const RITZ: StaySuggestion = {
    place: {
      id: "osm-node-1",
      name: "Hotel Ritz",
      city: "Lisbon",
      country: "PT",
      coords: coords(-9.15, 38.72),
    },
    type: "hotel",
  };

  const TRAM: ActivitySuggestion = {
    place: {
      id: "osm-way-2",
      name: "Tram 28",
      city: "Lisbon",
      country: "PT",
      coords: coords(-9.13, 38.71),
    },
    category: "sight",
  };

  /** Walk the popup to a given step with the destination answered. */
  async function atStep(
    step: 4 | 5,
    handlers: Parameters<typeof atStepTwo>[0] = {},
  ) {
    await atStepTwo(handlers);
    click(lisbonCard()!);
    await advance("Next");
    if (step === 5) await advance("Next");
  }

  it("lists what the loader found, and hands the item back when ticked", async () => {
    const onToggleStay = vi.fn<(item: StaySuggestion, add: boolean) => void>();
    await atStep(4, { stays: [RITZ], onToggleStay });

    const row = buttonSaying("Hotel Ritz");
    expect(row).toBeDefined();
    // The model's own word for it, so the chip and the trip agree.
    expect(row!.textContent).toContain("Hotel");

    click(row!);

    expect(onToggleStay).toHaveBeenCalledTimes(1);
    expect(onToggleStay.mock.calls[0][0].place.id).toBe(RITZ.place.id);
    expect(onToggleStay.mock.calls[0][1]).toBe(true);
  });

  it("shows what is already on the trip as pressed, and unticks it", async () => {
    // The trip is the source of truth for "is this on my list", so a
    // step re-entered after an add has to come back already ticked.
    const onToggleStay = vi.fn<(item: StaySuggestion, add: boolean) => void>();
    await atStep(4, {
      stays: [RITZ],
      chosenStayIds: new Set([RITZ.place.id]),
      onToggleStay,
    });

    const row = buttonSaying("Hotel Ritz")!;
    expect(row.getAttribute("aria-pressed")).toBe("true");

    click(row);

    // Pressed means the next click removes — an add-only control would
    // strand a mis-click on the trip, since nothing else in the app
    // reads stays yet.
    expect(onToggleStay.mock.calls[0][1]).toBe(false);
  });

  it("says so and still offers the way on when a city has nothing", async () => {
    await atStep(4, { stays: [] });

    expect(container.querySelector('[role="group"]')).toBeNull();
    expect(container.textContent).toContain("No hotels or hostels listed");
    expect(buttonSaying("Next")).toBeDefined();
  });

  it("asks about activities on the fifth screen, separately from stays", async () => {
    const onToggleActivity =
      vi.fn<(item: ActivitySuggestion, add: boolean) => void>();
    await atStep(5, { stays: [RITZ], activities: [TRAM], onToggleActivity });

    expect(container.textContent).toContain("Step 5 of 5");
    // The stay list is gone, not merged in: two questions, two screens.
    expect(buttonSaying("Hotel Ritz")).toBeUndefined();

    click(buttonSaying("Tram 28")!);

    expect(onToggleActivity).toHaveBeenCalledTimes(1);
    expect(onToggleActivity.mock.calls[0][0].category).toBe("sight");
  });
});
