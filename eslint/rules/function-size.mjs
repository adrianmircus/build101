// Counts code lines of a function (no blanks, no comment-only lines) and applies a bigger limit to
// React components. A component is a function whose name starts with an uppercase letter, because
// that is what React and the JSX transform rely on too. `const X = memo(() => ...)` and
// `forwardRef` wrappers take the variable's name, since the inner function is anonymous.

const WRAPPERS = new Set(["memo", "forwardRef"]);
const TEST_BLOCKS = new Set(["describe", "it", "test", "beforeEach", "afterEach", "beforeAll", "afterAll"]);

function wrapperName(callee) {
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression" && callee.property.type === "Identifier") return callee.property.name;
  return null;
}

function functionName(node) {
  let current = node;
  while (current.parent.type === "CallExpression" && WRAPPERS.has(wrapperName(current.parent.callee))) {
    current = current.parent;
  }
  const wrapped = current !== node;
  if (node.id && !wrapped) return node.id.name;
  const parent = current.parent;
  if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier") return parent.id.name;
  return node.id ? node.id.name : null;
}

// it("x", () => ...), describe.each(rows)("x", () => ...), test.step("x", async () => ...)
function testRoot(callee) {
  let current = callee;
  while (current.type === "CallExpression" || current.type === "MemberExpression") {
    current = current.type === "CallExpression" ? current.callee : current.object;
  }
  return current.type === "Identifier" ? current.name : null;
}

// The callback of a test block holds a whole suite or case, so it is not held to the function
// limit. Helpers declared next to the tests still are.
function isTestCallback(node) {
  const parent = node.parent;
  if (parent.type !== "CallExpression" || !parent.arguments.includes(node)) return false;
  const root = testRoot(parent.callee);
  return root !== null && TEST_BLOCKS.has(root);
}

function isComponentName(name) {
  return name !== null && /^[A-Z]/.test(name);
}

function codeLines(sourceCode, node) {
  const comments = sourceCode.getAllComments();
  let count = 0;
  for (let line = node.loc.start.line; line <= node.loc.end.line; line++) {
    const start = sourceCode.getIndexFromLoc({ line, column: 0 });
    const text = sourceCode.lines[line - 1];
    let rest = "";
    let cursor = start;
    for (const c of comments) {
      if (c.range[1] <= start || c.range[0] >= start + text.length) continue;
      rest += sourceCode.text.slice(cursor, Math.max(cursor, c.range[0]));
      cursor = Math.max(cursor, c.range[1]);
    }
    rest += sourceCode.text.slice(cursor, start + text.length);
    if (rest.trim() !== "") count++;
  }
  return count;
}

export const functionSize = {
  meta: {
    type: "suggestion",
    schema: [
      {
        type: "object",
        properties: {
          max: { type: "integer" },
          componentMax: { type: "integer" },
          exemptTestCallbacks: { type: "boolean" },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      tooLong: "{{kind}} '{{name}}' has {{lines}} lines (max {{max}}). Split it.",
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const max = options.max ?? 40;
    const componentMax = options.componentMax ?? max;
    const sourceCode = context.sourceCode;

    function check(node) {
      if (options.exemptTestCallbacks && isTestCallback(node)) return;
      const name = functionName(node);
      const component = isComponentName(name);
      const limit = component ? componentMax : max;
      const lines = codeLines(sourceCode, node);
      if (lines <= limit) return;
      context.report({
        node,
        loc: node.loc.start,
        messageId: "tooLong",
        data: { kind: component ? "Component" : "Function", name: name ?? "anonymous", lines, max: limit },
      });
    }
    return {
      FunctionDeclaration: check,
      FunctionExpression: check,
      ArrowFunctionExpression: check,
    };
  },
};
