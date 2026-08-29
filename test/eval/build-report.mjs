import fs from "node:fs";
const rows = JSON.parse(fs.readFileSync("out/data.json", "utf8"));
const notes = JSON.parse(fs.readFileSync("out/notes.json", "utf8"));
const img = (p) => "data:image/jpeg;base64," + fs.readFileSync(p).toString("base64");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const TYPE = { architecture: "Architecture", flowchart: "Flowchart", sequence: "Sequence", state: "State machine", er: "ER / data model", "db-schema": "Database schema", timeline: "Timeline", swimlane: "Swimlane", quadrant: "Quadrant", tree: "Tree", "org-chart": "Org chart", layers: "Layer stack", kanban: "Kanban", journey: "User journey", deployment: "Deployment", dependency: "Dependency graph" };
const VERDICT = { pass: "Pass", minor: "Minor", defect: "Defect" };
const secs = rows.map((r) => r.seconds).sort((a, b) => a - b);
const total = secs.reduce((a, b) => a + b, 0), median = (secs[7] + secs[8]) / 2;
const count = (v) => rows.filter((r) => notes[r.slug].verdict === v).length;
const withLegend = rows.filter((r) => r.metrics.legend).length, withFocal = rows.filter((r) => r.metrics.focal > 0 && r.metrics.focal <= 2).length;
const leaders = rows.reduce((a, r) => a + r.metrics.leaders, 0), noteCount = rows.reduce((a, r) => a + r.metrics.notes, 0);
const overlapRows = rows.filter((r) => r.metrics.overlaps.length).length;

const tableRows = rows.map((r) => { const v = notes[r.slug].verdict; const m = r.metrics; return `<tr><td><a href="#d${r.n}">${r.n}</a></td><td><a href="#d${r.n}">${TYPE[r.slug]}</a></td><td class="num">${r.seconds}</td><td class="num">${m.nodes}</td><td class="num">${m.arrows}</td><td class="num">${m.elbowed}</td><td class="num">${m.notes}</td><td class="num">${m.leaders}</td><td class="num">${m.focal}</td><td>${m.legend ? "yes" : "no"}</td><td class="num">${m.overlaps.length}</td><td class="num">${r.fixes}</td><td><span class="chip ${v}">${VERDICT[v]}</span></td></tr>`; }).join("\n");

const cards = rows.map((r) => { const v = notes[r.slug].verdict; const m = r.metrics; return `
<article class="card" id="d${r.n}">
  <header class="card-head">
    <span class="idx">${r.n}</span>
    <h3>${TYPE[r.slug]}</h3>
    <span class="chip ${v}">${VERDICT[v]}</span>
    <span class="ref">${esc(r.ref)}</span>
  </header>
  <figure class="shot"><img src="${img(r.image)}" alt="${esc(r.frame)}" loading="lazy"><figcaption>${esc(r.frame)}</figcaption></figure>
  <dl class="facts">
    <div><dt>Prompt</dt><dd>${esc(r.prompt)}</dd></div>
    <div><dt>Agent said</dt><dd class="mono">${esc(r.report)}</dd></div>
    <div><dt>Review</dt><dd>${esc(notes[r.slug].note)}</dd></div>
    <div><dt>Numbers</dt><dd class="mono">${r.seconds}s &middot; ${r.tools} tool calls &middot; ${r.draws} draw, ${r.fixes} fix &middot; ${m.nodes} nodes, ${m.sections} sections, ${m.arrows} arrows (${m.elbowed} elbowed, ${m.dashed} dashed) &middot; ${m.notes} notes, ${m.leaders} leaders &middot; ${m.focal} focal &middot; legend ${m.legend ? "yes" : "no"} &middot; ${m.overlaps.length} overlaps${m.overlaps.length ? ": " + esc(m.overlaps.slice(0, 4).join("; ")) : ""}</dd></div>
  </dl>
</article>`; }).join("\n");

const html = `<title>Explainer Diagram Evaluation</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playpen+Sans:wght@500;600&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root{--paper:#f7f6f2;--card:#ffffff;--ink:#1d2230;--muted:#6a6f7c;--rule:#dedbd3;--accent:#e8590c;--pass:#2f9e44;--minor:#c98a00;--defect:#c92a2a;--pass-bg:#e6f4ea;--minor-bg:#fbf1d9;--defect-bg:#fbe5e5;--shot:#fbfaf7;}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--paper:#15171c;--card:#1c1f26;--ink:#e9e8e3;--muted:#9a9ea9;--rule:#2b2f38;--accent:#f0803a;--pass:#63c27a;--minor:#e0b04a;--defect:#f07272;--pass-bg:#1b2e21;--minor-bg:#32290f;--defect-bg:#3a1d1d;--shot:#23262e;}}
:root[data-theme="dark"]{--paper:#15171c;--card:#1c1f26;--ink:#e9e8e3;--muted:#9a9ea9;--rule:#2b2f38;--accent:#f0803a;--pass:#63c27a;--minor:#e0b04a;--defect:#f07272;--pass-bg:#1b2e21;--minor-bg:#32290f;--defect-bg:#3a1d1d;--shot:#23262e;}
body{background:var(--paper);color:var(--ink);font-family:Inter,"Helvetica Neue",Arial,sans-serif;font-size:15px;line-height:1.5;}
.wrap{max-width:1120px;margin:0 auto;padding:40px 24px 80px;}
h1{font-family:"Playpen Sans","Comic Sans MS",cursive;font-weight:600;font-size:34px;line-height:1.15;margin:0 0 6px;text-wrap:balance;}
h2{font-family:"Playpen Sans","Comic Sans MS",cursive;font-weight:500;font-size:22px;margin:56px 0 14px;text-wrap:balance;}
h3{font-family:Inter,sans-serif;font-weight:600;font-size:18px;margin:0;}
.lede{color:var(--muted);max-width:68ch;margin:0 0 24px;}
.mono,.num,.facts dd.mono,.ref,td.num{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums;}
.run{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:0 0 8px;}
.run div{background:var(--card);border:1px solid var(--rule);border-radius:6px;padding:12px 14px;}
.run dt{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 4px;}
.run dd{margin:0;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:20px;font-weight:500;}
.run dd small{font-size:12px;color:var(--muted);font-weight:400;margin-left:4px;}
.tally{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0 0;}
.chip{display:inline-block;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:12px;font-weight:500;letter-spacing:.04em;padding:2px 9px;border-radius:999px;line-height:1.6;}
.chip.pass{background:var(--pass-bg);color:var(--pass);}
.chip.minor{background:var(--minor-bg);color:var(--minor);}
.chip.defect{background:var(--defect-bg);color:var(--defect);}
.tally .chip{font-size:13px;padding:4px 12px;}
.tablewrap{overflow-x:auto;border:1px solid var(--rule);border-radius:6px;background:var(--card);}
table{border-collapse:collapse;width:100%;font-size:13.5px;}
th,td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--rule);white-space:nowrap;}
th{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:500;}
th.num,td.num{text-align:right;}
tr:last-child td{border-bottom:0;}
td a{color:inherit;text-decoration:none;border-bottom:1px dotted var(--muted);}
td a:hover,td a:focus-visible{color:var(--accent);border-color:var(--accent);outline:none;}
.cards{display:grid;gap:28px;}
.card{background:var(--card);border:1px solid var(--rule);border-radius:8px;overflow:hidden;}
.card-head{display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid var(--rule);flex-wrap:wrap;}
.idx{font-family:"IBM Plex Mono",ui-monospace,monospace;color:var(--muted);font-size:13px;}
.ref{margin-left:auto;font-size:12px;color:var(--muted);}
.shot{margin:0;background:var(--shot);border-bottom:1px solid var(--rule);}
.shot img{display:block;width:100%;height:auto;max-height:720px;object-fit:contain;}
.shot figcaption{font-size:12px;color:var(--muted);padding:6px 18px 8px;border-top:1px solid var(--rule);}
.facts{margin:0;padding:12px 18px 16px;display:grid;gap:8px;}
.facts div{display:grid;grid-template-columns:96px 1fr;gap:12px;align-items:baseline;}
.facts dt{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);}
.facts dd{margin:0;max-width:90ch;}
.facts dd.mono{font-size:12.5px;color:var(--muted);}
.findings{display:grid;gap:12px;padding:0;margin:0;list-style:none;counter-reset:f;}
.findings li{background:var(--card);border:1px solid var(--rule);border-left:3px solid var(--accent);border-radius:6px;padding:12px 16px;}
.findings li.fixed{border-left-color:var(--pass);}
.findings b{display:block;margin-bottom:2px;}
.findings .who{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:12px;color:var(--muted);margin-left:6px;}
.method{max-width:70ch;color:var(--muted);}
.method code,.facts code{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:.92em;}
@media (max-width:640px){.facts div{grid-template-columns:1fr;gap:2px;} h1{font-size:28px;}}
</style>
<div class="wrap">
<h1>Explainer Diagram Evaluation</h1>
<p class="lede">Sixteen prompts, one per diagram type in the ported diagram-design skill, drawn by the agent on a clean canvas. Each frame exported through Excalidraw, measured, and reviewed by hand. Run on 2026-08-29.</p>

<dl class="run">
<div><dt>Diagrams</dt><dd>16<small>of 16 types</small></dd></div>
<div><dt>Right reference</dt><dd>16<small>of 16</small></dd></div>
<div><dt>Tool errors</dt><dd>0</dd></div>
<div><dt>Median time</dt><dd>${median}<small>s per diagram</small></dd></div>
<div><dt>Total time</dt><dd>${Math.round(total / 60)}<small>min</small></dd></div>
<div><dt>Legend strips</dt><dd>${withLegend}<small>of 16</small></dd></div>
<div><dt>Focal 1-2 nodes</dt><dd>${withFocal}<small>of 16</small></dd></div>
<div><dt>Notes with leader</dt><dd>${leaders}<small>of ${noteCount} notes</small></dd></div>
</dl>
<div class="tally"><span class="chip pass">Pass ${count("pass")}</span><span class="chip minor">Minor ${count("minor")}</span><span class="chip defect">Defect ${count("defect")}</span></div>

<h2>Scoreboard</h2>
<div class="tablewrap"><table>
<thead><tr><th>#</th><th>Type</th><th class="num">s</th><th class="num">Nodes</th><th class="num">Arrows</th><th class="num">Elbowed</th><th class="num">Notes</th><th class="num">Leaders</th><th class="num">Focal</th><th>Legend</th><th class="num">Overlaps</th><th class="num">Fix calls</th><th>Verdict</th></tr></thead>
<tbody>
${tableRows}
</tbody></table></div>
<p class="method">Overlaps: a text that intersects a shape it is not inside of, or another text (measured on the scene). Fix calls: <code>update_elements</code> and <code>delete_elements</code> the agent issued after its first draw. Verdict: pass = nothing to fix by hand; minor = a cosmetic overlap; defect = something a reader would trip on.</p>

<h2>Findings</h2>
<ol class="findings">
<li class="fixed"><b>Frames do not grow when the agent moves a note after drawing<span class="who">layers, dependency</span></b>A frame clips its children. When the agent moved a note past the edge with <code>update_elements</code>, the note was cut. Fixed after the run in commit <code>109ea0a</code>: the app now grows the frame in <code>update_elements</code> and <code>draw_elements</code>.</li>
<li><b>Elbow arrow labels land on nodes and lane borders<span class="who">swimlane, deployment</span></b>Excalidraw places an arrow label at the path midpoint. On a short elbow the midpoint sits on a node edge or a lane border. Open: place the label on the longest segment, or push the far node as the spacing pass does for straight arrows.</li>
<li><b>Tree layout ignores the one-row rule for siblings<span class="who">tree</span></b>The reference asks for siblings on one row; the model put two of them far below the root. Open: an auto layout for trees (dagre through <code>draw_mermaid</code>) or a tighter rule in the type reference.</li>
<li><b>Leader dots land on text<span class="who">db-schema, timeline</span></b>A leader bound to a text element ends on the text itself. Open: bind leaders to shapes only, or offset the dot.</li>
<li><b>Cycle edge and diagonal edges in the dependency graph<span class="who">dependency</span></b>The back-edge crosses a node it does not connect, and the rank edges are diagonal instead of elbowed. Open: the reference asks for <code>elbowed: true</code>; the model used explicit points.</li>
<li><b>Wrapped card titles overlap their sublabel<span class="who">kanban</span></b>A two-line title in a 56 px card runs into the sublabel. Open: the app could grow the card, or the reference can cap titles at one line.</li>
<li><b>No legend when a diagram uses no notation kind<span class="who">journey</span></b>By design: the strip needs two entries. Keep, or always add the arrow styles.</li>
</ol>

<h2>The sixteen diagrams</h2>
<div class="cards">
${cards}
</div>

<h2>Method</h2>
<p class="method">Explainer dev build, commit <code>515e2e4</code>, model <code>claude-opus-5</code>, permission mode auto. A new agent session per prompt. The prompt, the agent's last chat line, the tool calls and the timing come from the chat log; node and arrow counts, notes, leaders, focal nodes, legend and overlaps are measured on the scene after the turn. Images are Excalidraw frame exports at up to 1800 px.</p>
</div>
`;
fs.writeFileSync("out/report.html", html);
console.log("report.html", Math.round(fs.statSync("out/report.html").size / 1024) + "KB", "median", median, "total", total, "pass/minor/defect", count("pass"), count("minor"), count("defect"), "legend", withLegend, "focal", withFocal, "leaders", leaders, "notes", noteCount, "overlapRows", overlapRows);
