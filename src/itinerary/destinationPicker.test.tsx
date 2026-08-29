// ============================================================
// Rendered tests for the destination choice point.
//
// No testing-library: the repo's rule is one dependency at a time
// with a reason, and React 19 exports `act` itself, which is all
// three of these need. The helpers below are ~20 lines and only do
// what these tests actually use — mount, click, type.
// ============================================================

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Place } from "../model/trip";
import { POPULAR_DESTINATIONS } from "../lib/popularDestinations";
import { DestinationPicker } from "./DestinationPicker";
import { InspirationGrid } from "./InspirationGrid";

// React refuses to run `act` without this, and jsdom doesn't set it.
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

/** Set an input's value the way React's synthetic onChange will see it. */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;

  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function cards(): HTMLButtonElement[] {
  return [
    ...container.querySelectorAll<HTMLButtonElement>(
      'button[aria-label^="Add "]',
    ),
  ];
}

describe("InspirationGrid", () => {
  it("renders every curated destination, with its hook", () => {
    render(<InspirationGrid onSelect={() => {}} />);

    expect(cards()).toHaveLength(POPULAR_DESTINATIONS.length);

    // The hook is the reason to pick a card, so it has to be on it.
    for (const { hook } of POPULAR_DESTINATIONS) {
      expect(container.textContent).toContain(hook);
    }
  });

  it("emits the curated Place, coordinates intact and in [lng, lat] order", () => {
    const onSelect = vi.fn<(place: Place) => void>();
    render(<InspirationGrid onSelect={onSelect} />);

    const lisbon = cards().find((c) =>
      c.getAttribute("aria-label")?.startsWith("Add Lisbon,"),
    );
    click(lisbon!);

    expect(onSelect).toHaveBeenCalledTimes(1);
    const place = onSelect.mock.calls[0][0];
    expect(place.name).toBe("Lisbon");
    expect(place.country).toBe("PT");
    // Longitude first: a flip would put Lisbon in Sudan.
    expect(place.coords[0]).toBeCloseTo(-9.1393, 4);
    expect(place.coords[1]).toBeCloseTo(38.7223, 4);
  });

  it("narrows to one region when a region chip is pressed", () => {
    render(<InspirationGrid onSelect={() => {}} />);

    const oceania = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((b) => b.textContent?.startsWith("Oceania"));

    click(oceania!);

    const oceanic = POPULAR_DESTINATIONS.filter((d) => d.region === "oceania");
    expect(oceanic.length).toBeGreaterThan(0);
    expect(cards()).toHaveLength(oceanic.length);
  });

  it("badges a destination the trip already holds, by distance not by id", () => {
    // Nominatim's Lisbon: different id, different spelling, same city.
    const lisboa: Place = {
      id: "osm-4521",
      name: "Lisboa",
      city: "Lisboa",
      country: "PT",
      coords: [-9.1427, 38.7167],
    };

    render(<InspirationGrid onSelect={() => {}} knownPlaces={[lisboa]} />);

    const lisbon = cards().find((c) =>
      c.getAttribute("aria-label")?.startsWith("Add Lisbon,"),
    );
    expect(lisbon?.textContent).toContain("In trip");

    const porto = cards().find((c) =>
      c.getAttribute("aria-label")?.startsWith("Add Porto,"),
    );
    expect(porto?.textContent).not.toContain("In trip");
  });
});

describe("DestinationPicker", () => {
  function input(): HTMLInputElement {
    return container.querySelector<HTMLInputElement>('input[role="combobox"]')!;
  }

  function options(): HTMLElement[] {
    return [...container.querySelectorAll<HTMLElement>('[role="option"]')];
  }

  it("browses when the field is empty", () => {
    render(<DestinationPicker onSelect={() => {}} />);

    expect(cards()).toHaveLength(POPULAR_DESTINATIONS.length);
    expect(options()).toHaveLength(0);
    expect(input().getAttribute("aria-expanded")).toBe("false");
  });

  it("answers from the curated list before the network is asked", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<DestinationPicker onSelect={() => {}} />);

    // Two characters: below the remote threshold on purpose.
    type(input(), "li");

    expect(input().getAttribute("aria-expanded")).toBe("true");
    expect(options().length).toBeGreaterThan(0);
    expect(container.textContent).toContain("Lisbon");
    expect(fetchSpy).not.toHaveBeenCalled();
    // The browse steps aside for results rather than sitting under them.
    expect(cards()).toHaveLength(0);
  });

  it("debounces the geocoder to one request per typing burst", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("[]", { status: 200 }));

    try {
      render(<DestinationPicker onSelect={() => {}} />);

      type(input(), "Lis");
      type(input(), "Lisb");
      type(input(), "Lisbo");

      expect(fetchSpy).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      // Nominatim's policy is ~1 request/second; five keystrokes must
      // not be five requests.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(String(fetchSpy.mock.calls[0][0])).toContain("q=Lisbo");
    } finally {
      vi.useRealTimers();
    }
  });

  it("selects the active row on Enter and clears back to the browse", () => {
    const onSelect = vi.fn<(place: Place) => void>();
    render(<DestinationPicker onSelect={onSelect} />);

    type(input(), "lisbo");
    act(() => {
      input().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].name).toBe("Lisbon");
    expect(input().value).toBe("");
    expect(cards()).toHaveLength(POPULAR_DESTINATIONS.length);
  });

  it("returns to the browse on Escape", () => {
    render(<DestinationPicker onSelect={() => {}} />);

    type(input(), "lisbo");
    expect(cards()).toHaveLength(0);

    act(() => {
      input().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(input().value).toBe("");
    expect(cards()).toHaveLength(POPULAR_DESTINATIONS.length);
  });

  it("drops the previous query's rows when a search fails", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            place_id: 1,
            lat: "47.3769",
            lon: "8.5417",
            display_name: "Zürich",
            name: "Zürich",
            address: { city: "Zürich", country_code: "ch" },
          },
        ]),
        { status: 200 },
      ),
    );

    try {
      render(<DestinationPicker onSelect={() => {}} />);

      // Neither query is on the curated shortlist, so the listbox
      // holds nothing but what the geocoder said.
      type(input(), "zurich");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(container.textContent).toContain("Zürich");

      fetchSpy.mockRejectedValue(new Error("Place lookup failed (429)"));
      type(input(), "brussels");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      // Zürich under the word "brussels" is how you add the wrong
      // city to a trip, and the error has nowhere to draw while a
      // stale row is still filling the list.
      expect(container.textContent).not.toContain("Zürich");
      expect(container.textContent).toContain("429");
      expect(options()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("highlights the first row when results arrive after an arrow press", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            place_id: 2,
            lat: "50.8476",
            lon: "4.3572",
            display_name: "Brussels",
            name: "Brussels",
            address: { city: "Brussels", country_code: "be" },
          },
        ]),
        { status: 200 },
      ),
    );

    try {
      render(<DestinationPicker onSelect={() => {}} />);

      type(input(), "brussels");
      // Pressed while the list is still empty — the clamp must not
      // strand the active index below zero.
      act(() => {
        input().dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
        );
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      expect(options()).toHaveLength(1);
      expect(options()[0].getAttribute("aria-selected")).toBe("true");
      expect(input().getAttribute("aria-activedescendant")).toBe(
        options()[0].id,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts an in-flight search when it unmounts", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      signal = init?.signal ?? undefined;
      return new Promise(() => {});
    });

    try {
      render(<DestinationPicker onSelect={() => {}} />);
      type(input(), "Lisbon");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      expect(signal?.aborted).toBe(false);
      act(() => root.unmount());
      expect(signal?.aborted).toBe(true);

      // afterEach unmounts again; make that a no-op rather than a throw.
      root = createRoot(document.createElement("div"));
    } finally {
      vi.useRealTimers();
    }
  });
});
