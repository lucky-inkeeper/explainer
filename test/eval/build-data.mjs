// Merge out/summary.md, the chat logs, the prompts in eval-run.sh, out/metrics.json and out/png/* into out/data.json
import fs from "node:fs";
const metrics = JSON.parse(JSON.parse(fs.readFileSync("out/metrics.json", "utf8")));
const summary = fs.readFileSync("out/summary.md", "utf8").trim().split("\n");
const sh = fs.readFileSync("eval-run.sh", "utf8");
const prompts = [...sh.matchAll(/^\s+"([a-z-]+)\|(.+)"$/gm)].map((m) => ({ slug: m[1], prompt: m[2] }));
const pngs = fs.readdirSync("out/png").sort();
const rows = summary.map((line, i) => {
  const m = line.match(/^- (\d+) ([a-z-]+): --- (\d+)s frame="(.*?)".*\| msg text \| (.*)$/);
  const log = fs.readFileSync(`out/${m[1]}-${m[2]}.log`, "utf8");
  const tools = (log.match(/^tool/gm) || []).length, errors = (log.match(/^tool err/gm) || []).length;
  const ref = (log.match(/references\/(type-[a-z-]+\.md)/) || [])[1];
  const draws = (log.match(/canvas: draw_elements/g) || []).length + (log.match(/canvas: draw_mermaid/g) || []).length;
  const fixes = (log.match(/canvas: (update_elements|delete_elements)/g) || []).length;
  return { n: m[1], slug: m[2], seconds: +m[3], frame: m[4], report: m[5].trim(), prompt: prompts[i].prompt, tools, errors, ref, draws, fixes, image: "out/png/" + pngs[i], metrics: metrics[i] };
});
fs.writeFileSync("out/data.json", JSON.stringify(rows, null, 1));
console.log(rows.length, "rows");
