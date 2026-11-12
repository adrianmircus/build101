// One opKey per request makes a repeated send harmless (the server answers the same). So a retry of the SAME request
// (same content) after a dropped connection keeps its key, and any change in what is sent gets a fresh one.

export type Attempt = { opKey: string; signature: string };

/** The attempt to use now: the previous one when the content did not change, a new one otherwise. */
export function attemptFor(previous: Attempt | null, signature: string, freshKey: () => string): Attempt {
  return previous && previous.signature === signature ? previous : { opKey: freshKey(), signature };
}
