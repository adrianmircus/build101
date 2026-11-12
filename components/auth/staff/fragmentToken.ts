// A token comes in the fragment of the URL (/invitacion#<token>): the browser never sends it to the server. The page
// reads it once, clears the address bar and keeps it only in memory for the actions that follow. React Strict Mode
// runs effects twice in development, and the second run finds the bar already clean: that is why it is held here.

let held = "";

// A token has a shape. The invitation's is 43 characters of base64url (32 bytes). The recovery's is the hashed token of Supabase Auth:
// 56 hex characters, with the `pkce_` prefix when the link was asked for with PKCE. Anything else in the fragment is one of two things:
// an internal anchor («Saltar al contenido» puts #main-content in the bar), which must not touch the token that is already held, or a
// link that is not one (cut short, pasted halfway), which must make the previous context forget its token: a good link of A followed
// by a broken one of B may not leave the form of A open.
const TOKEN_SHAPE = /^(?:[A-Za-z0-9_-]{43}|(?:pkce_)?[0-9a-f]{56})$/;

/** True when the fragment (with or without the «#») has the shape of a token. */
export function isTokenShaped(fragment: string): boolean {
  return TOKEN_SHAPE.test(fragment.replace(/^#/, ""));
}

/** The anchors the app itself puts in the bar. Any id that exists in the page also counts (see `isAnchor`). */
const KNOWN_ANCHORS = ["main-content"];

function isAnchor(id: string): boolean {
  if (KNOWN_ANCHORS.includes(id)) return true;
  return typeof document !== "undefined" && document.getElementById(id) !== null;
}

/** What the fragment is: nothing, a token, an anchor of this page, or something that is neither (a cut link): «invalid». */
export type FragmentKind = "empty" | "token" | "anchor" | "invalid";

export function fragmentKind(fragment: string): FragmentKind {
  const id = fragment.replace(/^#/, "");
  if (id === "") return "empty";
  if (isTokenShaped(id)) return "token";
  return isAnchor(id) ? "anchor" : "invalid";
}

/**
 * Reads and clears the fragment when it is a token. With nothing in it, or an anchor, returns what was read before on this page load (or "").
 * A fragment that is neither a token nor an anchor replaces what was held with nothing: the link in the bar is the one that counts now.
 */
export function takeFragmentToken(): string {
  const fragment = window.location.hash.replace(/^#/, "");
  const kind = fragmentKind(fragment);
  if (kind === "token") held = fragment;
  if (kind === "invalid") held = "";
  if (kind === "token" || kind === "invalid") window.history.replaceState(null, "", window.location.pathname + window.location.search);
  return held;
}

/** For tests: forgets what was held. */
export function forgetFragmentToken(): void {
  held = "";
}

/** Calls `onChange` when a new link is put in the bar of this same page (a link pasted over the open page): a token, or one that does not work. An anchor is ignored. Returns how to stop. */
export function onFragmentChange(onChange: () => void): () => void {
  const listener = () => {
    const kind = fragmentKind(window.location.hash);
    if (kind === "token" || kind === "invalid") onChange();
  };
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}
