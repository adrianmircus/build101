// A token comes in the fragment of the URL (/invitacion#<token>): the browser never sends it to the server. The page
// reads it once, clears the address bar and keeps it only in memory for the actions that follow. React Strict Mode
// runs effects twice in development, and the second run finds the bar already clean: that is why it is held here.

let held = "";

// A token has a shape. The invitation's is 43 characters of base64url (32 bytes). The recovery's is the hashed token of Supabase Auth:
// 56 hex characters, with the `pkce_` prefix when the link was asked for with PKCE. Anything else in the fragment is an internal
// anchor («Saltar al contenido» puts #main-content in the bar) and must not replace the token that is already held.
const TOKEN_SHAPE = /^(?:[A-Za-z0-9_-]{43}|(?:pkce_)?[0-9a-f]{56})$/;

/** True when the fragment (with or without the «#») has the shape of a token. */
export function isTokenShaped(fragment: string): boolean {
  return TOKEN_SHAPE.test(fragment.replace(/^#/, ""));
}

/** Reads and clears the fragment when it is a token. With no token in it (empty, or an anchor), returns what was read before on this page load (or ""). */
export function takeFragmentToken(): string {
  const fragment = window.location.hash.replace(/^#/, "");
  if (isTokenShaped(fragment)) {
    held = fragment;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  return held;
}

/** For tests: forgets what was held. */
export function forgetFragmentToken(): void {
  held = "";
}

/** Calls `onChange` when a new TOKEN is put in the bar of this same page (a link pasted over the open page). An anchor is ignored. Returns how to stop. */
export function onFragmentChange(onChange: () => void): () => void {
  const listener = () => {
    if (isTokenShaped(window.location.hash)) onChange();
  };
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}
