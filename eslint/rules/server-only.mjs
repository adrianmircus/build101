// Server modules must fail the build if a client bundle ever pulls them in, so the first statement
// (after directives) has to be the side-effect import `import "server-only";`. Forms such as
// `import type {} from "server-only"` or `import {} from "server-only"` are erased when compiled,
// so the protection would silently disappear.
const SIDE_EFFECT_IMPORT = /^import\s*(["'])server-only\1/;

export const requireServerOnly = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      missing:
        'Files in lib/server must start with the side-effect import `import "server-only";` (no type import, no specifiers).',
    },
  },
  create(context) {
    return {
      Program(node) {
        const first = node.body.find((s) => !(s.type === "ExpressionStatement" && s.directive));
        if (first === undefined) return;
        const ok =
          first.type === "ImportDeclaration" &&
          first.source.value === "server-only" &&
          first.specifiers.length === 0 &&
          first.importKind !== "type" &&
          SIDE_EFFECT_IMPORT.test(context.sourceCode.getText(first));
        if (!ok) context.report({ node: first, messageId: "missing" });
      },
    };
  },
};
