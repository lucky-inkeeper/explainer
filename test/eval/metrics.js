(() => {
  const els = window.__xapi.getSceneElements();
  const SH = new Set(["rectangle", "ellipse", "diamond"]);
  const frames = els.filter((e) => e.type === "frame").sort((a, b) => a.x - b.x);
  return JSON.stringify(frames.map((f) => {
    const inF = els.filter((e) => e.frameId === f.id);
    const { classify, isFocal, NOTATION } = window.__layout; // the Notation table, not a copy of its colors
    const legend = inF.filter((e) => (e.groupIds?.[0] || "").startsWith(NOTATION.legendGroup));
    const body = inF.filter((e) => !legend.includes(e));
    const shapes = body.filter((e) => SH.has(e.type));
    const sections = shapes.filter((e) => classify(e) === "section");
    const nodes = shapes.filter((e) => !sections.includes(e));
    const arrows = body.filter((e) => e.type === "arrow");
    const texts = body.filter((e) => e.type === "text");
    const notes = texts.filter((e) => classify(e) === "note");
    const leaders = arrows.filter((e) => e.endArrowhead === "dot");
    const focal = nodes.filter(isFocal).length;
    const overlaps = window.__layout.inspect(inF); // one overlap definition: the app's own (ADR-0005)
    return { name: f.name ?? "(unnamed)", elements: inF.length, nodes: nodes.length, sections: sections.length, arrows: arrows.length, elbowed: arrows.filter((a) => a.elbowed).length, dashed: arrows.filter((a) => a.strokeStyle === "dashed").length, notes: notes.length, leaders: leaders.length, focal, legend: legend.length > 0, overlaps };
  }), null, 1);
})()
