import type { Result } from "@/lib/errors";

/** A Server Action as the screens receive it: the page imports it and passes it down, so a test can pass a fake. */
export type ActionFn<Input, Output> = (input: Input) => Promise<Result<Output>>;
