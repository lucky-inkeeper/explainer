import { createRoot } from "react-dom/client";
import "@excalidraw/excalidraw/index.css";
import "./fonts/fonts.css";
import "./style.css";
import { App } from "./App";
import { Viewer } from "./Viewer";

// ?view=<blob URL>: the read-only page for a shared drawing, opened in any browser (no window.api there)
const view = new URLSearchParams(location.search).get("view");

let beat = Date.now();
if (!view) setInterval(() => { const now = Date.now(), lag = now - beat - 1000; if (lag > 300) window.api.send("log:stall", "renderer", lag); beat = now; }, 1000);

// canvas text is measured with the real font: wait for the web fonts (bounded, so offline still starts)
Promise.race([
  Promise.all([document.fonts.load('20px "Playpen Sans"'), document.fonts.load("20px Inter")]),
  new Promise((r) => setTimeout(r, 3000)),
]).finally(() => createRoot(document.getElementById("root")!).render(view ? <Viewer src={view} /> : <App />));
