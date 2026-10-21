// Phones put the on-screen keyboard over the page rather than shrinking it, so a full-height chat's message box ends up
// under the keyboard. This tracks the part of the screen the keyboard leaves visible (the visual viewport) as CSS
// variables on <html>, for full-height screens to size themselves to:
//   --app-height  the visible height
//   --app-top     how far the browser has scrolled the page to keep the focused box in view (iOS)
// and sets data-keyboard on <html> while the keyboard is open, so the bottom safe-area padding can go.

const KEYBOARD_MIN = 120;

export function trackKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  // The tallest the visible area has been at this width: much shorter than that means the keyboard is up.
  let width = vv.width;
  let tallest = vv.height;
  const update = () => {
    if (vv.width !== width) [width, tallest] = [vv.width, vv.height];
    tallest = Math.max(tallest, vv.height);
    root.style.setProperty("--app-height", `${vv.height}px`);
    root.style.setProperty("--app-top", `${vv.offsetTop}px`);
    root.toggleAttribute("data-keyboard", tallest - vv.height > KEYBOARD_MIN);
  };
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  update();
}

/** Call `fn` whenever the visible area changes size, e.g. to keep the newest message in view as the keyboard opens. */
export function onVisibleResize(fn: () => void): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  vv.addEventListener("resize", fn);
  return () => vv.removeEventListener("resize", fn);
}
