// React starts a view transition (document.startViewTransition) on every page change. When the screen changes size
// midway (a phone rotating, the browser bar showing or hiding, a page that suddenly gets wider) the browser aborts the
// transition and its `ready` promise rejects with an InvalidStateError ("Transition was aborted because of invalid
// state. Viewport size changed"). React ignores that error only when its message is one of the exact texts it knows,
// and this one carries an extra sentence, so it was reported as an uncaught error in the console.
//
// An aborted transition only means the page changes without animation, so the guard gives React the message it
// already treats as harmless. Any other error, and everything else about the transition, stays as it is.

type Starter = typeof document.startViewTransition;

// One of the texts React's own check lets pass (react-dom, startViewTransition).
const HARMLESS = "Skipping view transition because viewport size changed.";

const isAbort = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "InvalidStateError" && error.message.startsWith("Transition was aborted");

let installed = false;

export function guardViewTransitions(): void {
  if (installed || typeof document === "undefined" || typeof document.startViewTransition !== "function") return;
  installed = true;
  const start = document.startViewTransition;
  document.startViewTransition = function (this: Document, ...args: Parameters<Starter>) {
    const transition = start.apply(this, args);
    const ready = transition.ready.catch((error: unknown) => {
      throw isAbort(error) ? new DOMException(HARMLESS, "InvalidStateError") : error;
    });
    Object.defineProperty(transition, "ready", { value: ready, configurable: true });
    return transition;
  } as Starter;
}
