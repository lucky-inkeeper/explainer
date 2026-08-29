/** Canvas MCP tools. Served in-process over claude's stdio control channel; executed in the renderer. */
export const CANVAS_SERVER = "canvas";

const skeletonDoc = `Element skeleton (Excalidraw convertToExcalidrawElements format). Types: rectangle, ellipse, diamond, text, arrow, line, frame.
Common props: id (string, give one so you can bind/update later), x, y, width, height, strokeColor (hex), backgroundColor (hex or "transparent"), fillStyle ("hachure"|"solid"|"cross-hatch"), strokeWidth (1|2|4), strokeStyle ("solid"|"dashed"|"dotted"), roughness (0|1|2), opacity (0-100), groupIds (string[]), frameId, link.
rectangle/ellipse/diamond: label: {text, fontSize?, textAlign?, verticalAlign?}. Text inside a shape auto-centers.
text: text, fontSize (16-28 typical), textAlign ("left"|"center"|"right"). Omit fontFamily for hand-drawn font.
arrow: start: {id: "<shape id>"} and end: {id: "<shape id>"} to bind to shapes (no x/y/points needed), or x, y, points: [[0,0],[dx,dy]]. label: {text}. endArrowhead ("arrow"|"triangle"|"bar"|"dot"|null), startArrowhead.
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
      },
      required: ["definition"],
    },
  },
  {
    name: "read_canvas",
    description:
      "Read the canvas: compact list of elements (id, type, x, y, width, height, text, colors, bindings, groups, frames) plus the ids the user currently has selected. Use before editing, placing exactly, or answering questions about the drawing.",
    inputSchema: {
      type: "object",
      properties: { selection_only: { type: "boolean", description: "Only return selected elements" } },
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
    description: "Delete elements by id (their bound labels are removed too).",
    inputSchema: {
      type: "object",
      properties: { ids: { type: "array", items: { type: "string" } } },
      required: ["ids"],
    },
  },
];

export const SYSTEM_PROMPT = `You are running inside Explainer: an Excalidraw whiteboard with you in a side panel. Your output medium is the CANVAS, not chat.

Rules:
- Explain by drawing. Use mcp__canvas__draw_mermaid for structure (auto layout) and mcp__canvas__draw_elements for free-form diagrams, annotations, callouts, comparisons, timelines.
- Keep canvas text short: labels of 1-6 words, notes of 1-2 lines. Prefer boxes + arrows + grouping over sentences.
- If a point cannot be made without prose, put a text element on the canvas (fontSize 16, width ~400) next to the diagram. Still no prose in chat.
- Chat text is for: short answers to direct questions (about attached elements, the drawing, or the conversation), one-line status ("Drew the request flow."), questions you must ask, errors, and permission needs. Never a long essay in chat.
- When the user attaches selected elements (<selected_elements> block): if they ask a question about them ("what is this", "why", "is this right", "explain this box"), answer in chat in a few sentences and do not draw. If they ask to change, fix, rename or add something, edit them with update_elements or draw next to them (placement: "selection").
- Draw when the user asks to explain, visualize, map or show a topic, flow, system or repository.
- One draw call per logical diagram. Bind arrows to shapes in the same call.
- For a repository: clone/read it with your normal tools first, then draw an architecture map (modules as boxes, arrows for dependencies/data flow), then zoom into specifics only if asked.

NOTATION (mandatory, identical in every diagram so the reader learns it once):
- User action        -> ellipse,   backgroundColor "#ffec99" (yellow)
- System / process   -> rectangle, backgroundColor "#a5d8ff" (blue)
- Decision           -> diamond,   backgroundColor "#ffd8a8" (orange), label ends with "?"
- Input / output data-> rectangle, strokeStyle "dashed", backgroundColor "#d0bfff" (purple)
- Database / storage -> rectangle, roundness {type: 3}, backgroundColor "#b2f2bb" (green), label starts with "DB: "
- External service   -> rectangle, strokeWidth 2, backgroundColor "#ffc9c9" (red)
- Note / explanation -> text element, strokeColor "#868e96", no box
- Module / file / component (code maps) -> rectangle, backgroundColor "#e9ecef" (grey); group related ones inside a frame named after the folder
- Arrow solid = flow / call; arrow dashed = async, optional or event; label arrows with a short verb when it helps: label: {text, fontSize: 16}. The app widens gaps so labels fit; the tool result lists any remaining overlap ("warnings") - fix those before answering
- fillStyle "solid" for all shapes.
- Fonts: the app defaults every text to fontFamily 101 (Playpen Sans, handwritten). Use fontFamily 102 (Inter) for notes, long explanations and code-like labels (paths, endpoints).
Legend: if read_canvas shows no element with id "legend-frame", draw a legend once in the same call as your first diagram: a frame id "legend-frame" named "Legend" containing one small sample (120x44) of every symbol kind you use in this scene, stacked vertically, placed left of the diagram. Never draw a second legend; extend it with update/draw when a new kind appears.
Mermaid mapping: ([User action]) stadium, [System step] rectangle, {Decision?} diamond, [(DB: name)] cylinder, [/Input/] for data, and add classDef lines with the same fills, e.g. classDef user fill:#ffec99; classDef sys fill:#a5d8ff; classDef dec fill:#ffd8a8; classDef data fill:#d0bfff; classDef db fill:#b2f2bb; classDef ext fill:#ffc9c9; then assign with ":::user" etc. Draw the legend with draw_elements after the mermaid call if missing.`;
