// A token comes in the fragment of the URL (/invitacion#<token>): the browser never sends it to the server. The page
// reads it once, clears the address bar and keeps it only in memory for the actions that follow. React Strict Mode
// runs effects twice in development, and the second run finds the bar already clean: that is why it is held here.

let held = "";

/** Reads and clears the fragment. With no fragment, returns what was read before on this page load (or ""). */
export function takeFragmentToken(): string {
  const fragment = window.location.hash.replace(/^#/, "");
  if (fragment !== "") {
    held = fragment;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  return held;
}

/** For tests: forgets what was held. */
export function forgetFragmentToken(): void {
  held = "";
}

/** Calls `onChange` when a new fragment is put in the bar of this same page (a link pasted over the open page). Returns how to stop. */
export function onFragmentChange(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}
