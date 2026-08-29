/** Canvas MCP tools. Served in-process over claude's stdio control channel; executed in the renderer. */
export const CANVAS_SERVER = "canvas";

/**
 * The Notation: one symbol per kind, fixed in every diagram. The NOTATION block of the system prompt, the legend strip, the layout
 * checks and the eval metrics all read this table; a color lives nowhere else.
 */
export const KINDS: { color: string; label: string; type: "rectangle" | "ellipse" | "diamond"; strokeStyle?: "dashed"; rounded?: boolean; strokeWidth?: number; prompt: string; colorName: string; hint?: string; mermaid?: string }[] = [
  { color: "#ffec99", label: "User action", type: "ellipse", prompt: "User action", colorName: "yellow", mermaid: "user" },
  { color: "#a5d8ff", label: "System / process", type: "rectangle", prompt: "System / process", colorName: "blue", mermaid: "sys" },
  { color: "#ffd8a8", label: "Decision", type: "diamond", prompt: "Decision", colorName: "orange", hint: 'label ends with "?"', mermaid: "dec" },
  { color: "#d0bfff", label: "Data", type: "rectangle", strokeStyle: "dashed", prompt: "Input / output data", colorName: "purple", mermaid: "data" },
  { color: "#b2f2bb", label: "Database", type: "rectangle", rounded: true, prompt: "Database / storage", colorName: "green", hint: 'label starts with "DB: "', mermaid: "db" },
  { color: "#ffc9c9", label: "External service", type: "rectangle", strokeWidth: 2, prompt: "External service", colorName: "red", mermaid: "ext" },
  { color: "#e9ecef", label: "Module / file", type: "rectangle", prompt: "Module / file / component (code maps)", colorName: "grey" },
];
export const FOCAL = "#e8590c";
export const NOTATION = {
  kinds: KINDS,
  section: { color: "#f8f9fa" },
  note: { color: "#868e96", fontFamily: 102, fontSize: 16, maxWidth: 320 },
  focal: { color: FOCAL, strokeWidth: 2 },
  legendGroup: "legend-",
};
const SHAPE_TYPES = ["rectangle", "ellipse", "diamond", "image"];
const lc = (c?: string | null) => (c ?? "").toLowerCase();
type Classifiable = { type: string; backgroundColor?: string | null; strokeColor?: string | null; containerId?: string | null; fontSize?: number };
/** What an element is in the Notation: a kind label, "section", "note", or null. Shapes match on fill only (Mermaid renders a stadium as a rounded rectangle). */
export function classify(e: Classifiable): string | null {
  if (e.type === "text") return !e.containerId && lc(e.strokeColor) === NOTATION.note.color && (e.fontSize ?? 0) >= NOTATION.note.fontSize ? "note" : null;
  if (!SHAPE_TYPES.includes(e.type)) return null;
  if (lc(e.backgroundColor) === NOTATION.section.color) return "section";
  return KINDS.find((k) => k.color === lc(e.backgroundColor))?.label ?? null;
}
/** Focal treatment: the orange stroke on a shape; the fill keeps the kind color. */
export const isFocal = (e: Classifiable) => SHAPE_TYPES.includes(e.type) && lc(e.strokeColor) === FOCAL;

const kindLine = (k: (typeof KINDS)[number]) => {
  const extra = k.strokeStyle ? `strokeStyle "${k.strokeStyle}", ` : k.rounded ? "roundness {type: 3}, " : k.strokeWidth ? `strokeWidth ${k.strokeWidth}, ` : "";
  return `- ${k.prompt.padEnd(19)}-> ${(k.type + ",").padEnd(11)}${extra}backgroundColor "${k.color}" (${k.colorName})${k.hint ? `, ${k.hint}` : ""}`;
};
const { note, section, focal } = NOTATION;
const NOTATION_BLOCK = `NOTATION (mandatory, identical in every diagram so the reader learns it once):
${KINDS.map(kindLine).join("\n")}
- Note / explanation -> text element, strokeColor "${note.color}", fontFamily ${note.fontFamily}, fontSize ${note.fontSize}, width <= ${note.maxWidth}, no box. A note points at what it explains: put it within 40px of that element, or add a leader: arrow with strokeStyle "dashed", strokeWidth 1, strokeColor "${note.color}", endArrowhead "dot", start: {id: "<note id>"}, end: {id: "<shape id>"} (leaders bind to shapes or text, never to an arrow). Max 2 notes per diagram.
- Focal (the 1-2 nodes the reader must notice) -> strokeColor "${focal.color}", strokeWidth ${focal.strokeWidth}; the fill stays the kind color. Never more than 2 per diagram.
- Frame: exactly ONE per complete diagram, around the whole diagram: pass frame: "<diagram title>" to draw_elements or draw_mermaid and the app wraps the batch. Never one frame per lane, user, module or layer, never nested frames, never a frame for a small annotation added next to an existing diagram.
- Section inside a diagram (a user's lane, a swimlane, a module group, a layer, a phase) -> a container rectangle listed BEFORE its members (so they draw on top): backgroundColor "${section.color}", strokeStyle "dashed", roughness 0, roundness {type: 3}, plus a small title text at its top-left (fontSize 14, fontFamily ${note.fontFamily}, strokeColor "${note.color}"). Give the container, its title and its members the same groupIds entry so they move together. Leave 24px padding inside.
- No diagonal arrows: a bound arrow whose ends share neither a row nor a column is routed by the app as a right-angle elbow; for a free arrow give only horizontal and vertical segments. Arrow solid = flow / call; arrow dashed = async, optional or event; label arrows with a short verb when it helps: label: {text, fontSize: 16}. The app widens gaps so labels fit; the tool result lists any remaining overlap ("warnings") - fix those before answering
- fillStyle "solid" for all shapes.
- Fonts: the app defaults every text to fontFamily 101 (Playpen Sans, handwritten). Use fontFamily ${note.fontFamily} (Inter) for notes, long explanations and code-like labels (paths, endpoints).
Legend: the app adds a legend strip (the kinds and arrow styles used) at the bottom of every framed diagram. Never draw a legend yourself.
Mermaid mapping: ([User action]) stadium, [System step] rectangle, {Decision?} diamond, [(DB: name)] cylinder, [/Input/] for data, and add classDef lines with the same fills, e.g. ${KINDS.filter((k) => k.mermaid).map((k) => `classDef ${k.mermaid} fill:${k.color};`).join(" ")} then assign with ":::user" etc.`;

const skeletonDoc = `Element skeleton (Excalidraw convertToExcalidrawElements format). Types: rectangle, ellipse, diamond, text, arrow, line, frame.
Common props: id (string, give one so you can bind/update later), x, y, width, height, strokeColor (hex), backgroundColor (hex or "transparent"), fillStyle ("hachure"|"solid"|"cross-hatch"), strokeWidth (1|2|4), strokeStyle ("solid"|"dashed"|"dotted"), roughness (0|1|2), opacity (0-100), groupIds (string[]), frameId, link.
rectangle/ellipse/diamond: label: {text, fontSize?, textAlign?, verticalAlign?}. Text inside a shape auto-centers.
text: text, fontSize (16-28 typical), textAlign ("left"|"center"|"right"), width (the text wraps to it; x stays the left edge whatever the alignment). Omit fontFamily for hand-drawn font.
arrow: start: {id: "<shape id>"} and end: {id: "<shape id>"} to bind to shapes (no x/y/points needed), or x, y, points: [[0,0],[dx,dy]]. label: {text}. endArrowhead ("arrow"|"triangle"|"bar"|"dot"|null), startArrowhead. elbowed: true on a bound arrow = right-angle connector (the app routes it: leaves and enters through the facing sides, one bend pair).
line: x, y, points: [[0,0],[dx,dy],...].
frame: children: ["<id>", ...], name: "title".
Bind arrows to shapes in the SAME call (bindings need the shape in the same batch). Keep width >= 140 for labeled boxes, height >= 60. Leave 60-120px gaps.`;

export const TOOLS = [
  {
    name: "draw_elements",
    description: `Draw new elements on the shared Excalidraw canvas. Coordinates in your batch are relative to the batch; by default the app places the whole batch in free space (right of existing content, or next to the user's attached selection). ${skeletonDoc}`,
    inputSchema: {
      type: "object",
      properties: {
        elements: { type: "array", description: "Element skeletons", items: { type: "object" } },
        placement: {
          type: "string",
          enum: ["auto", "selection", "exact"],
          description: "auto (default): free space right of all content. selection: right of the user's selected elements. exact: use your x/y as absolute scene coordinates (use read_canvas first).",
        },
        frame: { type: "string", description: "Diagram title. The app wraps the whole batch in one frame with this name. Use it for every complete diagram; do not add your own outer frame then." },
      },
      required: ["elements"],
    },
  },
  {
    name: "draw_mermaid",
    description:
      "Draw a Mermaid diagram (flowchart, sequence, class) on the canvas with automatic layout. Best for structure: architecture, call flow, data flow, dependency graphs. Placed in free space like draw_elements. Returns created element ids.",
    inputSchema: {
      type: "object",
      properties: {
        definition: { type: "string", description: "Mermaid source, e.g. 'flowchart LR\\n A[Client] --> B[API]'" },
        placement: { type: "string", enum: ["auto", "selection"] },
        frame: { type: "string", description: "Diagram title. The app wraps the result in one frame with this name. Use it for every complete diagram." },
      },
      required: ["definition"],
    },
  },
  {
    name: "read_canvas",
    description:
      "Read the canvas: compact list of elements (id, type, x, y, width, height, text, colors, bindings, groups, frames) plus the ids the user currently has selected and the list of frames. Scope it: pass frame (the diagram title or frame id) or ids; an unscoped read of a large canvas returns only the frame list. Use before editing, placing exactly, or answering questions about the drawing.",
    inputSchema: {
      type: "object",
      properties: {
        selection_only: { type: "boolean", description: "Only return selected elements" },
        frame: { type: "string", description: "Only the elements of this frame (its name or id), e.g. the diagram you just drew" },
        ids: { type: "array", items: { type: "string" }, description: "Only these element ids (a frame id includes its children)" },
      },
    },
  },
  {
    name: "update_elements",
    description:
      "Update existing elements by id. Each update is {id, ...props}: any skeleton prop (x, y, width, height, strokeColor, backgroundColor, text for text elements, label text via text on the bound text element, opacity, strokeStyle...).",
    inputSchema: {
      type: "object",
      properties: { updates: { type: "array", items: { type: "object" } } },
      required: ["updates"],
    },
  },
  {
    name: "delete_elements",
    description: "Delete elements by id, or a whole diagram by its frame. Deleting a frame deletes everything inside it; bound labels go with their element. To clear several diagrams, call this once per frame with `frame`; never read the .excalidraw file from disk to collect ids.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "Element ids to delete" },
        frame: { type: "string", description: "A frame name or id: delete the frame and all its contents" },
      },
    },
  },
];

export const SYSTEM_PROMPT = `You are running inside Explainer: an Excalidraw whiteboard with you in a side panel. Your output medium is the CANVAS, not chat.

Rules:
- Explain by drawing. Use mcp__canvas__draw_mermaid for structure (auto layout) and mcp__canvas__draw_elements for free-form diagrams, annotations, callouts, comparisons, timelines.
- Keep canvas text short: labels of 1-6 words, notes of 1-2 lines. Prefer boxes + arrows + grouping over sentences.
- If a point cannot be made without prose, put a Note (see NOTATION) on the canvas next to the element it explains. Still no prose in chat.
- Chat text is for: short answers to direct questions (about attached elements, the drawing, or the conversation), one-line status ("Drew the request flow."), questions you must ask, errors, and permission needs. Never a long essay in chat.
- When the user attaches selected elements (<selected_elements> block): if they ask a question about them ("what is this", "why", "is this right", "explain this box"), answer in chat in a few sentences and do not draw. If they ask to change, fix, rename or add something, edit them with update_elements or draw next to them (placement: "selection").
- Draw when the user asks to explain, visualize, map or show a topic, flow, system or repository.
- Before every new complete diagram: invoke the diagram-design skill (Skill tool), pick the type from its table, read that type reference, then draw. Skip it for a small annotation or an edit of existing elements. Never ask for approval before drawing. After drawing, one line in chat with the type and the count: "Drew a swimlane (3 lanes, 9 steps)."
- One draw call per logical diagram. Bind arrows to shapes in the same call.
- For a repository: clone/read it with your normal tools first, then draw an architecture map (modules as boxes, arrows for dependencies/data flow), then zoom into specifics only if asked.

${NOTATION_BLOCK}`;
