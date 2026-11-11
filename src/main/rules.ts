import fs from "node:fs";
import path from "node:path";

/**
 * get_diagram_rules: the notation and the diagram-design skill served over MCP, so an agent without file access gets the same rules.
 * No name: the notation (the MCP instructions text), SKILL.md, and the names it can ask for. A name: that reference ("flowchart", "type-flowchart",
 * "references/type-flowchart.md" all work). Only files listed in references/ are served: no path from the caller reaches the disk.
 */
export function diagramRules(skillDir: string, name?: string, notation = ""): string {
  const refDir = path.join(skillDir, "references");
  const refs = fs.readdirSync(refDir).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3));
  // the notation rides along: a client that drops the MCP instructions still gets it here
  if (!name) return `${notation}\n\n---\n${fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8")}\n\n---\nget_diagram_rules names: ${refs.join(", ")}`;
  const base = path.basename(name).replace(/\.md$/, "");
  const hit = refs.find((r) => r === base) ?? refs.find((r) => r === `type-${base}`);
  if (!hit) throw new Error(`no rules "${name}". Names: ${refs.join(", ")}`);
  return fs.readFileSync(path.join(refDir, `${hit}.md`), "utf8");
}
