import type { CDPSession, Page } from "@playwright/test";
// The part of a CDP Accessibility.AXNode that this check reads (the protocol types are not exported by Playwright).
interface AXNode {
  nodeId: string;
  ignored?: boolean;
  role?: { value?: unknown };
  name?: { value?: unknown };
  description?: { value?: unknown };
  childIds?: string[];
  backendDOMNodeId?: number;
}

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

// Every resolved accessible name and description (aria-labelledby, aria-describedby, aria-label, alt, title, content)
// that a screen reader would announce outside the tour, taken from Chromium's accessibility tree.
export async function announcedStrings(page: Page): Promise<string[]> {
  const session = await page.context().newCDPSession(page);
  try {
    const { nodes } = await session.send("Accessibility.getFullAXTree");
    const byId = new Map(nodes.map((node) => [node.nodeId, node]));
    const skipped = skippedIds(nodes, await tourBackendIds(session), byId);
    return nodes
      .filter((node) => !node.ignored && !skipped.has(node.nodeId))
      .flatMap((node) => [node.name?.value, node.description?.value])
      .filter((value): value is string => typeof value === "string" && value !== "");
  } finally {
    await session.detach();
  }
}
