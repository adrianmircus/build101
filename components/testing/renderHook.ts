import * as React from "react";

// A tiny way to run a REAL hook in the node tests, with no DOM and no extra library: React lets us put our own dispatcher in
// place while a function runs, so useState, useReducer, useRef and useEffect keep their state here between renders.
// It is only for logic tests (state, effects, cleanup, late answers). What the screen looks like is tested with markup.

type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: (() => void) | void; effect?: () => (() => void) | void };
type Reducer = (state: unknown, action: unknown) => unknown;
type Effect = () => (() => void) | void;

// React keeps the current dispatcher in its internals; there is no public way to put one in.
const internals: { H: unknown } = (React as unknown as Record<string, { H: unknown }>).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

const sameDeps = (a?: readonly unknown[], b?: readonly unknown[]) => a !== undefined && b !== undefined && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));

class Root<T> {
  private slots: Slot[] = [];
  private cursor = 0;
  private alive = true;
  private rendering = false;
  result!: T;

  constructor(private hook: () => T) {
    this.render();
  }

  private slot(): Slot {
    const mine = (this.slots[this.cursor] ??= {});
    this.cursor += 1;
    return mine;
  }

  private reducer = (reducer: Reducer, initial: unknown, init?: (arg: unknown) => unknown) => {
    const mine = this.slot();
    if (!("value" in mine)) mine.value = init ? init(initial) : initial;
    const dispatch = (action: unknown) => {
      if (!this.alive) return;
      mine.value = reducer(mine.value, action);
      if (!this.rendering) this.render();
    };
    return [mine.value, dispatch];
  };

  private effect = (effect: Effect, deps?: readonly unknown[]) => {
    const mine = this.slot();
    if (sameDeps(mine.deps, deps)) return;
    mine.effect = effect;
    mine.deps = deps;
  };

  private memo = (factory: () => unknown, deps?: readonly unknown[]) => {
    const mine = this.slot();
    if (!sameDeps(mine.deps, deps)) {
      mine.value = factory();
      mine.deps = deps;
    }
    return mine.value;
  };

  private dispatcher = {
    useState: (initial: unknown) => this.reducer((state, action) => (typeof action === "function" ? action(state) : action), typeof initial === "function" ? initial() : initial),
    useReducer: this.reducer,
    useRef: (initial: unknown) => this.memo(() => ({ current: initial }), []),
    useMemo: this.memo,
    useCallback: (callback: unknown, deps?: readonly unknown[]) => this.memo(() => callback, deps),
    useEffect: this.effect,
    useLayoutEffect: this.effect,
    useId: () => "id",
  };

  private runEffects() {
    for (const mine of this.slots) {
      const effect = mine.effect;
      if (!effect) continue;
      mine.effect = undefined;
      mine.cleanup?.();
      mine.cleanup = effect();
    }
  }

  private render() {
    const before = internals.H;
    internals.H = this.dispatcher;
    this.cursor = 0;
    this.rendering = true;
    try {
      this.result = this.hook();
    } finally {
      this.rendering = false;
      internals.H = before;
    }
    this.runEffects();
  }

  /** Activity hiding the screen: every cleanup runs and the state is kept (that is why a form keeps what was typed). */
  hide() {
    for (const mine of this.slots) {
      const cleanup = mine.cleanup;
      mine.cleanup = undefined;
      cleanup?.();
    }
  }

  /** The screen leaves: the cleanups run, then nothing renders again. */
  unmount() {
    this.hide();
    this.alive = false;
  }
}

export function renderHook<T>(hook: () => T) {
  const root = new Root(hook);
  return {
    get current(): T {
      return root.result;
    },
    hide: () => root.hide(),
    unmount: () => root.unmount(),
  };
}
