// A dynamic import() whose target is not a literal cannot be resolved, so the layer and legacy
// rules could not judge it. New code must spell the target out.
import { staticTarget } from "./imports.mjs";

export const staticImportTarget = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      dynamic:
        "The target of import() must be a string literal (or a template without interpolations) so the layer rules can check it.",
    },
  },
  create(context) {
    return {
      ImportExpression(node) {
        if (staticTarget(node.source) === null) context.report({ node: node.source, messageId: "dynamic" });
      },
    };
  },
};
