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
// `detectLocation` is injected in EVERY test. The suite must never
// reach the network and must never touch real geolocation.
// ============================================================

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Place } from "../model/trip";
import { coords } from "../model/trip";
import type { HomeLocationResult } from "../lib/homeLocation";
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

describe("Welcome, step 2", () => {
  /** Step 1 answered via a detected fix — the one path with no network. */
  async function atStepTwo(handlers: {
    onDestination?: (place: Place) => void;
    onDone?: () => void;
  }) {
    render(
      <Welcome
        open
        onOrigin={noop}
        onDestination={handlers.onDestination ?? noop}
        onDone={handlers.onDone ?? noop}
        detectLocation={async () => ({ kind: "found", place: TORONTO })}
      />,
    );

    await act(async () => {
      buttonSaying("Use my location")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
  }

  it("emits the chosen destination and finishes", async () => {
    const onDestination = vi.fn<(place: Place) => void>();
    const onDone = vi.fn();
    await atStepTwo({ onDestination, onDone });

    const lisbon = [
      ...container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Add "]'),
    ].find((card) => card.getAttribute("aria-label")?.startsWith("Add Lisbon,"));

    click(lisbon!);

    expect(onDestination).toHaveBeenCalledTimes(1);
    expect(onDestination.mock.calls[0][0].city).toBe(LISBON.city);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
