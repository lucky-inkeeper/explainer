import { createRoot } from "react-dom/client";
import "@excalidraw/excalidraw/index.css";
import "./style.css";
import { App } from "./App";

let beat = Date.now();
setInterval(() => { const now = Date.now(), lag = now - beat - 1000; if (lag > 300) window.api.send("log:stall", "renderer", lag); beat = now; }, 1000);

// canvas text is measured with the real font: wait for the web fonts (bounded, so offline still starts)
Promise.race([
  Promise.all([document.fonts.load('20px "Playpen Sans"'), document.fonts.load("20px Inter")]),
  new Promise((r) => setTimeout(r, 3000)),
]).finally(() => createRoot(document.getElementById("root")!).render(<App />));
