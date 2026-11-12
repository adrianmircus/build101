import type { Field } from "./failure-view";
import { NeutralMessage } from "./NeutralMessage";
import { NoticeBody } from "./NoticeBody";

/** «Falta tu usuario»: right under the field that is missing, not at the end of the form. */
export function MissingNotice({ id, field }: { id: string; field: Field }) {
  return (
    <NeutralMessage id={id}>
      <NoticeBody notice={{ kind: "missing", field }} />
    </NeutralMessage>
  );
}
