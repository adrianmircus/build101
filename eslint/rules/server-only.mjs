// Server modules must fail the build if a client bundle ever pulls them in, so the first statement
// (after directives) has to be `import "server-only"`.

export const requireServerOnly = {
  meta: {
    type: "problem",
    schema: [],
    messages: { missing: 'Files in lib/server must start with `import "server-only";`.' },
  },
  create(context) {
    return {
      Program(node) {
        const first = node.body.find((s) => !(s.type === "ExpressionStatement" && s.directive));
        if (first === undefined) return;
        const ok = first.type === "ImportDeclaration" && first.source.value === "server-only";
        if (!ok) context.report({ node: first, messageId: "missing" });
      },
    };
  },
};
