(() => {
  const els = window.__xapi.getSceneElements();
  const seen = new Set(JSON.parse(localStorage.getItem("evalSeen") || "[]"));
  const fresh = els.filter((e) => e.type === "frame" && !seen.has(e.id));
  if (!fresh.length) return "no new frame";
  localStorage.setItem("evalSeen", JSON.stringify([...seen, ...fresh.map((f) => f.id)]));
  const ids = new Set(fresh.map((f) => f.id));
  const inFrames = els.filter((e) => ids.has(e.frameId));
  window.__xapi.scrollToContent([...fresh, ...inFrames], { fitToContent: true, animate: false, viewportZoomFactor: 0.9 });
  return fresh.map((f) => f.name).join(" | ") + ` (${inFrames.length} elements)`;
})()
