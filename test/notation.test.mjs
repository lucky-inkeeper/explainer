// The Notation is one table: the prompt block is rendered from it and classify() is what the legend, the layout checks and the eval use.
import { test } from "node:test";
import assert from "node:assert/strict";
import { KINDS, NOTATION, TOOLS, agentInstructions, classify, isFocal } from "../src/shared/tools.ts";

test("the MCP instructions carry every color of the table and fit Claude Code's 2048-char cap", () => {
  const text = agentInstructions("/Users/someone/Documents/Personal/Dev/explainer/agent/diagram-design/skills/diagram-design/SKILL.md");
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
