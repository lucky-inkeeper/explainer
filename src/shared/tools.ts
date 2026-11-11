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

type Lintable = Classifiable & { id: string; text?: string; width?: number; height?: number; endArrowhead?: string | null; startArrowhead?: string | null; strokeStyle?: string; strokeWidth?: number; fillStyle?: string; roundness?: unknown; groupIds?: string[]; isDeleted?: boolean; elbowed?: boolean; x?: number; y?: number; points?: number[][] };
/**
 * Notation warnings for a converted batch: the same feedback for every agent, whatever its client shows it.
 * `complete`: the batch is a new diagram (3+ shapes), so it needs the frame param.
 * ponytail: checks fill, shape, label rules, counts and diagonals; spacing quality stays with the layout warnings.
 */
export function notationWarnings(els: Lintable[], opts: { framed?: boolean } = {}): string[] {
  const out: string[] = [];
  const live = els.filter((e) => !e.isDeleted && !(e.groupIds?.[0] ?? "").startsWith(NOTATION.legendGroup));
  const label = (id: string) => live.find((t) => t.type === "text" && t.containerId === id)?.text?.trim() ?? "";
  // a marker dot (merge point, timeline tick) is <= 24 px and free in color
  const shapes = live.filter((e) => ["rectangle", "ellipse", "diamond"].includes(e.type) && Math.max(e.width ?? 99, e.height ?? 99) > 24);
  for (const e of shapes) {
    const fill = lc(e.backgroundColor);
    if (!fill || fill === "transparent" || fill === NOTATION.section.color) continue;
    const k = KINDS.find((k) => k.color === fill);
    if (!k) { out.push(`${e.type} ${e.id}: fill ${fill} is not in the notation`); continue; }
    if (e.type !== k.type) out.push(`${e.type} ${e.id}: ${k.label} must be a ${k.type}`);
    if (e.fillStyle && e.fillStyle !== "solid") out.push(`${e.type} ${e.id}: fillStyle must be "solid"`);
    if (k.strokeStyle && e.strokeStyle !== k.strokeStyle) out.push(`${e.type} ${e.id}: ${k.label} must be ${k.strokeStyle}`);
    if (k.rounded && !e.roundness) out.push(`${e.type} ${e.id}: ${k.label} needs roundness {type: 3}`);
    if (k.strokeWidth && (e.strokeWidth ?? 1) < k.strokeWidth) out.push(`${e.type} ${e.id}: ${k.label} needs strokeWidth ${k.strokeWidth}`);
    if (k.label === "Decision" && !label(e.id).endsWith("?")) out.push(`diamond ${e.id}: a decision label ends with "?"`);
    if (k.label === "Database" && !label(e.id).startsWith("DB: ")) out.push(`${e.type} ${e.id}: a database label starts with "DB: "`);
  }
  const focal = shapes.filter(isFocal).length;
  if (focal > 2) out.push(`${focal} focal elements; max 2`);
  const notes = live.filter((e) => classify(e) === "note").length;
  if (notes > 2) out.push(`${notes} notes; max 2`);
  for (const a of live) {
    if (a.type !== "arrow" || a.elbowed || !a.points) continue;
    if (a.endArrowhead === "dot" || a.startArrowhead === "dot") continue; // a note's leader may slant
    // ponytail: a slope under 24 px on the short axis reads as straight (shapes of different heights on one row)
    if (a.points.slice(1).some((p, i) => Math.min(Math.abs(p[0] - a.points![i][0]), Math.abs(p[1] - a.points![i][1])) > 24)) out.push(`arrow ${a.id} is diagonal: put its ends on one row or column, or use elbowed: true`);
  }
  if (!opts.framed && shapes.length >= 3) out.push(`a complete diagram (${shapes.length} shapes) needs the frame param`);
  return out;
}

const kindLine = (k: (typeof KINDS)[number]) => {
  const extra = k.strokeStyle ? `, ${k.strokeStyle}` : k.rounded ? ", roundness {type: 3}" : k.strokeWidth ? `, strokeWidth ${k.strokeWidth}` : "";
  return `- ${k.prompt}: ${k.type} ${k.color}${extra}${k.hint ? `, ${k.hint}` : ""}`;
};
const { note, section, focal } = NOTATION;
const MERMAID_MAP = `Mermaid mapping: ([User action]) stadium, [System step] rectangle, {Decision?} diamond, [(DB: name)] cylinder, [/Input/] for data, plus classDef lines with the notation fills: ${KINDS.filter((k) => k.mermaid).map((k) => `classDef ${k.mermaid} fill:${k.color};`).join(" ")} then assign with ":::user" etc.`;

/**
 * Sent in the MCP initialize result: the only channel that reaches every agent since the in-app sidebar was removed.
 * Claude Code silently cuts server instructions at 2048 chars (test/notation.test.mjs guards the length).
 */
export const agentInstructions = () => `Explainer canvas: you answer by drawing; chat gets one status line.
DRAWINGS: when the user names a canvas, pass it as \`drawing\` on every call; the app opens it. open_drawing lists names.
Before a new complete diagram, call get_diagram_rules, then get_diagram_rules with the type it names. Skip for small edits.
TEXT: labels 1-6 words, notes 1-2 lines. Boxes, arrows, grouping carry meaning, not sentences. Shorten words, never drop a fact the reader needs.
ICONS: one emoji at the start of a label when it names the thing faster (👤 user, 🗄️ DB, ☁️ cloud, 🔒 auth, ⚙️ job, 📄 file, 🌐 web). The label words stay. Real logos or screenshots: draw_image.
NOTATION (mandatory, every diagram; fillStyle "solid"):
${KINDS.map(kindLine).join("\n")}
- Note: text, strokeColor ${note.color}, fontFamily ${note.fontFamily}, fontSize ${note.fontSize}, width <= ${note.maxWidth}, no box, within 40px of its element or a dashed dot-end leader arrow. Max 2.
- Focal: strokeColor ${focal.color}, strokeWidth ${focal.strokeWidth}, fill keeps kind color. Max 2.
- Section (lane, layer, group): rectangle ${section.color}, dashed, roughness 0, listed before its members, title text fontSize 14 at top-left, same groupIds, 24px padding.
- Frame: exactly one per diagram via the frame param. Never nested, never per lane.
- Arrows: solid = flow/call, dashed = async/optional/event; short verb labels; no diagonals.
- Legend: the app adds it. Never draw a legend.
- The app checks this notation: fix every notation warning too.
- Fix every overlap listed in "warnings" before you answer.`;

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
    description: `Draw new elements on the shared Excalidraw canvas. Before a new complete diagram, call get_diagram_rules (it returns the notation and the layout rules). Coordinates in your batch are relative to the batch; by default the app places the whole batch in the nearest free space (right of or below existing content, or next to the user's attached selection). ${skeletonDoc}`,
    inputSchema: {
      type: "object",
      properties: {
        elements: { type: "array", description: "Element skeletons", items: { type: "object" } },
        placement: {
          type: "string",
          enum: ["auto", "selection", "exact"],
          description: "auto (default): nearest free space, right of or below existing content. selection: right of the user's selected elements. exact: use your x/y as absolute scene coordinates (use read_canvas first).",
        },
        frame: { type: "string", description: "Diagram title. The app wraps the whole batch in one frame with this name. Use it for every complete diagram; do not add your own outer frame then." },
      },
      required: ["elements"],
    },
  },
  {
    name: "draw_mermaid",
    description:
      `Draw a Mermaid diagram (flowchart, sequence, class) on the canvas with automatic layout. Best for structure: architecture, call flow, data flow, dependency graphs. Placed in free space like draw_elements. Returns created element ids. ${MERMAID_MAP}`,
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
    name: "draw_image",
    description:
      "Put pictures (PNG or JPEG) on the canvas: screenshots, mockups, photos. Each image becomes an image element, with an optional caption text next to it. Give a path on disk (absolute; the app reads it) or a dataURL. Default size is half the pixel size (retina screenshots); pass width and/or height to override, the aspect ratio is kept. Max 4 MB per image; the picture is stored inside the drawing. Placed in free space like draw_elements. Returns the element ids and the file ids (sha1 of the bytes: the same picture twice shares one file). To swap a picture later: draw_image is not needed, call update_elements with the image element id and a new fileId from an earlier draw_image, or just draw_image again. Tip for browser screenshots: an element screenshot of some components comes back blank; take a viewport screenshot and crop it by getBoundingClientRect() x devicePixelRatio.",
    inputSchema: {
      type: "object",
      properties: {
        images: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Element id; generated (img-<hash8>) when omitted" },
              path: { type: "string", description: "Absolute path of a PNG or JPEG on disk" },
              dataURL: { type: "string", description: "data:image/png;base64,... when you already have one" },
              caption: { type: "string", description: "Short text drawn next to the picture" },
              width: { type: "number" },
              height: { type: "number" },
            },
          },
        },
        layout: { type: "string", enum: ["column", "row"], description: "column (default): pictures stacked, caption to the right of each. row: side by side, caption below (left-aligned)." },
        placement: { type: "string", enum: ["auto", "selection", "exact"], description: "Same as draw_elements. exact uses x/y you pass on each image." },
        frame: { type: "string", description: "Title: the app wraps the batch in one frame with this name." },
      },
      required: ["images"],
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
      "Update existing elements by id. Each update is {id, ...props}: any skeleton prop (x, y, width, height, strokeColor, backgroundColor, text for text elements, label text via text on the bound text element, opacity, strokeStyle...). Moving a shape re-routes its bound arrows; the result lists any overlap or arrow crossing in the touched frames (\"warnings\") - fix those before answering.",
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
  {
    name: "open_drawing",
    description: "Without name: list every drawing (folder/name) and what is on screen. With name: show that drawing, like a tab click; split: true opens it beside the drawing shown alone. You rarely need it to open: every other tool takes `drawing` and opens it itself.",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "Drawing name, folder/name, or full path" }, split: { type: "boolean" } } },
  },
  {
    name: "get_diagram_rules",
    description: "The diagram-design rules. Without name: the notation (shape and color per kind), how to pick a diagram type, the layout rules for all types, and the names of the type references. With name (e.g. \"flowchart\", \"architecture\", \"semantic-patterns\"): that reference. Call it before a new complete diagram.",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "A type or reference name from the list" } } },
  },
];
/** Tools the main process answers itself; every other tool runs in the canvas. */
export const MAIN_TOOLS = new Set(["get_diagram_rules"]);
// every canvas tool can name its drawing; not on screen, the app opens it first. Without it the call goes to the focused pane
for (const t of TOOLS) if (t.name !== "open_drawing" && !MAIN_TOOLS.has(t.name)) (t.inputSchema.properties as Record<string, unknown>).drawing = {
  type: "string",
  description: "The drawing to act on: name, folder/name or path (open_drawing lists them). Not on screen: the app opens it first. Omit for the focused drawing.",
};
