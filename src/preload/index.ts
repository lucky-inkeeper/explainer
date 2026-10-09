import { contextBridge, ipcRenderer } from "electron";

// the UI is web content: it gets these channels and no others (the main process also checks the sender's origin)
const INVOKE = new Set(["state:get", "state:set", "file:read", "image:read", "file:write", "file:new", "drawings:list", "drawings:rename", "drawings:move", "drawings:delete", "drawings:newFolder", "drawings:renameFolder", "drawings:deleteFolder", "drawings:thumb", "drawings:thumbSet", "file:openDialog", "file:saveAsDialog", "share:post"]);
const SEND = new Set(["canvas:result", "log:stall"]);
const ON = new Set(["canvas:call", "drawings:synced"]);
const allow = (set: Set<string>, ch: string) => { if (!set.has(ch)) throw new Error(`channel not allowed: ${ch}`); };

contextBridge.exposeInMainWorld("api", {
  invoke: (ch: string, ...args: unknown[]) => { allow(INVOKE, ch); return ipcRenderer.invoke(ch, ...args); },
  send: (ch: string, ...args: unknown[]) => { allow(SEND, ch); ipcRenderer.send(ch, ...args); },
  on: (ch: string, cb: (...a: any[]) => void) => {
    allow(ON, ch);
    const l = (_e: unknown, ...a: unknown[]) => cb(...a);
    ipcRenderer.on(ch, l);
    return () => ipcRenderer.removeListener(ch, l);
  },
});
