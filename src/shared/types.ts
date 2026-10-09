export interface AppState {
  lastFile?: string;
  /** drawing file path -> creation time (ms); the atomic save replaces the inode, so the file system's birth time is useless */
  created?: Record<string, number>;
}

export interface DrawingInfo {
  path: string;
  /** file name without the .excalidraw extension */
  name: string;
  /** subfolder of data/drawings, or null at the root */
  folder: string | null;
  mtime: number;
  ctime: number;
}

export interface DrawingList {
  folders: string[];
  files: DrawingInfo[];
}

export interface CanvasCall {
  callId: string;
  tool: string;
  args: any;
}

export interface Api {
  invoke(ch: "state:get"): Promise<AppState>;
  invoke(ch: "state:set", patch: Partial<AppState>): Promise<AppState>;
  invoke(ch: "file:read", path: string): Promise<string | null>;
  invoke(ch: "image:read", src: { dataURL: string }): Promise<{ id: string; dataURL: string; mimeType: "image/png" | "image/jpeg"; width: number; height: number }>;
  invoke(ch: "file:write", path: string, text: string): Promise<void>;
  invoke(ch: "file:new", folder?: string | null): Promise<string>;
  invoke(ch: "drawings:list"): Promise<DrawingList>;
  invoke(ch: "drawings:rename", path: string, name: string): Promise<string>;
  invoke(ch: "drawings:move", path: string, folder: string | null): Promise<string>;
  invoke(ch: "drawings:delete", path: string): Promise<void>;
  invoke(ch: "drawings:newFolder", name: string): Promise<void>;
  invoke(ch: "drawings:renameFolder", name: string, next: string): Promise<void>;
  invoke(ch: "drawings:deleteFolder", name: string): Promise<void>;
  invoke(ch: "drawings:thumb", path: string, mtime: number): Promise<string | null>;
  invoke(ch: "drawings:thumbSet", path: string, mtime: number, dataUrl: string): Promise<void>;
  invoke(ch: "file:openDialog"): Promise<string | null>;
  invoke(ch: "file:saveAsDialog", currentPath: string): Promise<string | null>;
  invoke(ch: "share:post", json: string): Promise<{ url: string } | { error: string }>;
  send(ch: "canvas:result", payload: { callId: string; result?: any; error?: string }): void;
  send(ch: "log:stall", where: string, ms: number): void;
  on(ch: "canvas:call", cb: (call: CanvasCall) => void): () => void;
}

declare global {
  interface Window {
    api: Api;
  }
}
