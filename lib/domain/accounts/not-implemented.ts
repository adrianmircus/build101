/** Body of the pure rules that a ticket still has to write. It takes the arguments so the signatures stay honest. */
export function notImplemented(...used: readonly unknown[]): never {
  throw new Error(`not implemented (${used.length} arguments)`);
}
