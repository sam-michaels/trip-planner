// ============================================================
// Test environment shims.
//
// ONE RULE FOR THIS FILE: only stand in for a browser API that jsdom
// genuinely does not implement. It is not a place to make awkward code
// testable — a shim that changes behaviour rather than supplying a
// missing one turns a green suite into a lie about the app.
// ============================================================

// jsdom 29 ships `<dialog>` as an element but NOT its modal behaviour:
// `showModal`, `close` and `::backdrop` are all absent, so calling
// `dialog.showModal()` throws "is not a function" and every test of a
// component that opens one dies on mount.
//
// WHY SHIM RATHER THAN AVOID `<dialog>`: the native element is the
// reason the onboarding popup needs no focus-trap dependency — it gives
// focus containment, Escape-to-close and a `::backdrop` for free, and
// hand-rolling those is the single most commonly botched piece of
// accessibility work there is. The right trade is a few lines here, in
// the test environment, rather than a worse component in the app.
//
// WHAT THIS DOES AND DOESN'T GIVE YOU. It toggles `open` and fires
// `close`, which is all that "is the dialog showing, and does closing
// it tell the component" needs. It does NOT emulate focus containment,
// the top layer, or inertness of the rest of the page — jsdom has no
// layout, so those cannot be faithfully reproduced here and a stub
// pretending otherwise would assert a guarantee the shim isn't making.
// Verify focus behaviour in a real browser, not in this suite.
if (typeof HTMLDialogElement !== "undefined") {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal?: () => void;
    show?: () => void;
    close?: (returnValue?: string) => void;
  };

  if (!proto.showModal) {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
  }

  if (!proto.show) {
    proto.show = function show(this: HTMLDialogElement) {
      this.open = true;
    };
  }

  if (!proto.close) {
    proto.close = function close(this: HTMLDialogElement, returnValue?: string) {
      // Guard against re-entry: the real element ignores `close()` on an
      // already-closed dialog, and a component that closes in a `close`
      // handler would otherwise loop.
      if (!this.open) return;
      this.open = false;
      if (returnValue !== undefined) this.returnValue = returnValue;
      this.dispatchEvent(new Event("close"));
    };
  }
}
