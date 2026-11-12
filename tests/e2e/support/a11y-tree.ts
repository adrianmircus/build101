import type { CDPSession, Page } from "@playwright/test";
// The part of a CDP Accessibility.AXNode that this check reads (the protocol types are not exported by Playwright).
interface AXNode {
  nodeId: string;
  ignored?: boolean;
  role?: { value?: unknown };
  name?: { value?: unknown };
  description?: { value?: unknown };
  value?: { value?: unknown };
  properties?: { name: string; value?: { value?: unknown } }[];
  childIds?: string[];
  backendDOMNodeId?: number;
}

// Besides name and description, a screen reader reads these AX properties aloud (aria-roledescription, aria-valuetext).
const ANNOUNCED_PROPERTIES = new Set(["roledescription", "valuetext"]);

const TOUR_BUBBLE = '[role="dialog"][aria-labelledby^="tour-"]';

// Backend ids of the tour's bubbles: the teacher's guide, which may talk about profiles.
async function tourBackendIds(session: CDPSession): Promise<Set<number>> {
  const { root } = await session.send("DOM.getDocument", { depth: 0 });
  const { nodeIds } = await session.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector: TOUR_BUBBLE });
  const described = await Promise.all(nodeIds.map((nodeId) => session.send("DOM.describeNode", { nodeId })));
  return new Set(described.map((d) => d.node.backendNodeId));
}

function textUnder(node: AXNode, byId: Map<string, AXNode>): string {
  const own = node.role?.value === "StaticText" ? String(node.name?.value ?? "") : "";
  return own + (node.childIds ?? []).map((id) => textUnder(requireNode(byId, id), byId)).join("");
}

function requireNode(byId: Map<string, AXNode>, id: string): AXNode {
  const node = byId.get(id);
  if (!node) throw new Error(`Accessibility node ${id} is missing from the tree`);
  return node;
}

// The tour bubble and its "Recorrido: ..." live region are the teacher's guide, not the student's screen.
function isTourNode(node: AXNode, tourIds: Set<number>, byId: Map<string, AXNode>): boolean {
  if (node.backendDOMNodeId !== undefined && tourIds.has(node.backendDOMNodeId)) return true;
  return node.role?.value === "status" && textUnder(node, byId).startsWith("Recorrido:");
}

function skippedIds(nodes: AXNode[], tourIds: Set<number>, byId: Map<string, AXNode>): Set<string> {
  const skipped = new Set<string>();
  const skip = (node: AXNode) => {
    skipped.add(node.nodeId);
    (node.childIds ?? []).forEach((id) => skip(requireNode(byId, id)));
  };
  nodes.filter((node) => isTourNode(node, tourIds, byId)).forEach(skip);
  return skipped;
}

// Chromium leaves the AX "valuetext" property empty for some roles (a slider), so the attributes are read from the DOM too.
const ANNOUNCED_ATTRIBUTES = ["aria-roledescription", "aria-valuetext"];

async function attributeTexts(session: CDPSession): Promise<Map<number, string[]>> {
  const { root } = await session.send("DOM.getDocument", { depth: 0 });
  const selector = ANNOUNCED_ATTRIBUTES.map((name) => `[${name}]`).join(",");
  const { nodeIds } = await session.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector });
  const texts = new Map<number, string[]>();
  for (const nodeId of nodeIds) {
    const { node } = await session.send("DOM.describeNode", { nodeId });
    const { attributes } = await session.send("DOM.getAttributes", { nodeId });
    const values = attributes.flatMap((v, i) => (i % 2 === 1 && ANNOUNCED_ATTRIBUTES.includes(attributes[i - 1] ?? "") ? [v] : []));
    texts.set(node.backendNodeId, values);
  }
  return texts;
}

function announcedValues(node: AXNode, attrs: Map<number, string[]>): unknown[] {
  const props = (node.properties ?? []).filter((p) => ANNOUNCED_PROPERTIES.has(p.name)).map((p) => p.value?.value);
  const fromDom = node.backendDOMNodeId === undefined ? [] : (attrs.get(node.backendDOMNodeId) ?? []);
  return [node.name?.value, node.description?.value, node.value?.value, ...props, ...fromDom];
}

// Every resolved accessible name, description, value, role description and value text (aria-labelledby, aria-describedby,
// aria-label, aria-roledescription, aria-valuetext, alt, title, content) that a screen reader would announce outside the
// tour, taken from Chromium's accessibility tree.
export async function announcedStrings(page: Page): Promise<string[]> {
  const session = await page.context().newCDPSession(page);
  try {
    const { nodes } = await session.send("Accessibility.getFullAXTree");
    const byId = new Map(nodes.map((node) => [node.nodeId, node]));
    const skipped = skippedIds(nodes, await tourBackendIds(session), byId);
    const attrs = await attributeTexts(session);
    return nodes
      .filter((node) => !node.ignored && !skipped.has(node.nodeId))
      .flatMap((node) => announcedValues(node, attrs))
      .filter((value): value is string => typeof value === "string" && value !== "");
  } finally {
    await session.detach();
  }
}
