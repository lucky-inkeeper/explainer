// The Notation is one table: the prompt block is rendered from it and classify() is what the legend, the layout checks and the eval use.
import { test } from "node:test";
import assert from "node:assert/strict";
import { KINDS, NOTATION, TOOLS, agentInstructions, classify, isFocal } from "../src/shared/tools.ts";

test("the MCP instructions carry every color of the table and fit Claude Code's 2048-char cap", () => {
  const text = agentInstructions();
  for (const k of KINDS) assert.ok(text.includes(k.color), k.label);
  for (const c of [NOTATION.section.color, NOTATION.note.color, NOTATION.focal.color]) assert.ok(text.includes(c), c);
  assert.ok(text.length <= 2048, `instructions are ${text.length} chars`);
  for (const t of TOOLS) assert.ok(t.description.length <= 2048, `${t.name} description is ${t.description.length} chars`);
  assert.ok(TOOLS.find((t) => t.name === "draw_mermaid").description.includes("classDef db fill:#b2f2bb;"));
});

test("classify names kinds, sections and notes; fill matching ignores case", () => {
  assert.equal(classify({ type: "ellipse", backgroundColor: "#FFEC99" }), "User action");
  assert.equal(classify({ type: "rectangle", backgroundColor: "#f8f9fa" }), "section");
  assert.equal(classify({ type: "text", strokeColor: "#868e96", fontSize: 16 }), "note");
  assert.equal(classify({ type: "text", strokeColor: "#868e96", fontSize: 14 }), null, "a section title is not a note");
  assert.equal(classify({ type: "text", strokeColor: "#868e96", fontSize: 16, containerId: "x" }), null, "a label is not a note");
  assert.equal(classify({ type: "arrow" }), null);
  assert.equal(isFocal({ type: "rectangle", strokeColor: "#E8590C" }), true);
});

test("notationWarnings: a clean diagram passes; each broken rule is named", async () => {
  const { notationWarnings } = await import("../src/shared/tools.ts");
  const ok = [
    { id: "u", type: "ellipse", backgroundColor: "#ffec99", fillStyle: "solid" },
    { id: "d", type: "diamond", backgroundColor: "#ffd8a8", fillStyle: "solid" }, { id: "dl", type: "text", containerId: "d", text: "Valid?" },
    { id: "db", type: "rectangle", backgroundColor: "#b2f2bb", fillStyle: "solid", roundness: { type: 3 } }, { id: "dbl", type: "text", containerId: "db", text: "DB: users" },
    { id: "a", type: "arrow", x: 0, y: 0, points: [[0, 0], [100, 0]] },
  ];
  assert.deepEqual(notationWarnings(ok, { framed: true }), []);
  const bad = [
    { id: "x", type: "rectangle", backgroundColor: "#123456", fillStyle: "solid" },
    { id: "u", type: "rectangle", backgroundColor: "#ffec99", fillStyle: "hachure" },
    { id: "d", type: "diamond", backgroundColor: "#ffd8a8", fillStyle: "solid" }, { id: "dl", type: "text", containerId: "d", text: "Valid" },
    { id: "db", type: "rectangle", backgroundColor: "#b2f2bb", fillStyle: "solid" }, { id: "dbl", type: "text", containerId: "db", text: "users" },
    { id: "a", type: "arrow", x: 0, y: 0, points: [[0, 0], [100, 80]] },
  ];
  const w = notationWarnings(bad).join("\n");
  for (const s of ["#123456 is not in the notation", "must be a ellipse", 'fillStyle must be "solid"', 'ends with "?"', "roundness", '"DB: "', "arrow a is diagonal", "needs the frame param"]) assert.ok(w.includes(s), s);
  assert.deepEqual(notationWarnings([{ id: "a", type: "arrow", elbowed: true, x: 0, y: 0, points: [[0, 0], [100, 80]] }]), [], "an elbowed arrow is routed by the app");
});
