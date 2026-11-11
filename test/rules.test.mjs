// get_diagram_rules serves the skill files by name and nothing else from disk.
import { test } from "node:test";
import assert from "node:assert/strict";
import { diagramRules } from "../src/main/rules.ts";

const DIR = new URL("../agent/diagram-design/skills/diagram-design", import.meta.url).pathname;

test("get_diagram_rules: SKILL.md with the names, a reference by any spelling, nothing outside references/", () => {
  const all = diagramRules(DIR, undefined, "NOTATION block");
  assert.ok(all.startsWith("NOTATION block") && all.includes("# Diagram design") && all.includes("flowchart") && all.includes("semantic-patterns"));
  const flow = diagramRules(DIR, "flowchart");
  assert.equal(diagramRules(DIR, "type-flowchart"), flow);
  assert.equal(diagramRules(DIR, "references/type-flowchart.md"), flow);
  assert.ok(flow.startsWith("# Flowchart"));
  assert.throws(() => diagramRules(DIR, "../SKILL"), /no rules/);
  assert.throws(() => diagramRules(DIR, "/etc/passwd"), /no rules/);
});
