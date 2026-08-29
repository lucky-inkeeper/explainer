(() => {
  const els = window.__xapi.getSceneElements();
  const SH = new Set(["rectangle", "ellipse", "diamond"]);
  const frames = els.filter((e) => e.type === "frame").sort((a, b) => a.x - b.x);
  return JSON.stringify(frames.map((f) => {
    const inF = els.filter((e) => e.frameId === f.id);
    const legend = inF.filter((e) => (e.groupIds?.[0] || "").startsWith("legend-"));
    const body = inF.filter((e) => !legend.includes(e));
    const shapes = body.filter((e) => SH.has(e.type));
    const sections = shapes.filter((e) => (e.backgroundColor || "").toLowerCase() === "#f8f9fa");
    const nodes = shapes.filter((e) => !sections.includes(e));
    const arrows = body.filter((e) => e.type === "arrow");
    const texts = body.filter((e) => e.type === "text");
    const notes = texts.filter((e) => !e.containerId && (e.strokeColor || "").toLowerCase() === "#868e96" && e.fontSize >= 16);
    const leaders = arrows.filter((e) => e.endArrowhead === "dot");
    const focal = nodes.filter((e) => (e.strokeColor || "").toLowerCase() === "#e8590c").length;
    const overlaps = window.__layout.inspect(inF); // one overlap definition: the app's own (ADR-0005)
    return { name: f.name ?? "(unnamed)", elements: inF.length, nodes: nodes.length, sections: sections.length, arrows: arrows.length, elbowed: arrows.filter((a) => a.elbowed).length, dashed: arrows.filter((a) => a.strokeStyle === "dashed").length, notes: notes.length, leaders: leaders.length, focal, legend: legend.length > 0, overlaps };
  }), null, 1);
})()
