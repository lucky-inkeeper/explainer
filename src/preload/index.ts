import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  invoke: (ch: string, ...args: unknown[]) => ipcRenderer.invoke(ch, ...args),
  send: (ch: string, ...args: unknown[]) => ipcRenderer.send(ch, ...args),
  on: (ch: string, cb: (...a: any[]) => void) => {
    const l = (_e: unknown, ...a: unknown[]) => cb(...a);
    ipcRenderer.on(ch, l);
    return () => ipcRenderer.removeListener(ch, l);
  },
});
