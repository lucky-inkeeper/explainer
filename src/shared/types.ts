export type PermissionMode = "default" | "acceptEdits" | "plan" | "auto" | "bypassPermissions" | "dontAsk";

export interface AppState {
  lastFile?: string;
  workspace: string;
  model?: string;
  effort?: string;
  permissionMode: PermissionMode;
  /** drawing file path -> claude session id */
  sessions: Record<string, string>;
}

export interface StartOpts {
  cwd: string;
  resume?: string;
  fork?: boolean;
  model?: string;
  effort?: string;
  permissionMode?: PermissionMode;
}

export interface SessionInfo {
  id: string;
  title: string;
  mtime: number;
}

export interface CanvasCall {
  callId: string;
  tool: string;
  args: any;
}

export type ImageBlock = { type: "image"; source: { type: "base64"; media_type: string; data: string } };
export type UserContent = string | Array<{ type: "text"; text: string } | ImageBlock>;

export interface Api {
  invoke(ch: "state:get"): Promise<AppState>;
  invoke(ch: "state:set", patch: Partial<AppState>): Promise<AppState>;
  invoke(ch: "file:read", path: string): Promise<string | null>;
  invoke(ch: "file:write", path: string, text: string): Promise<void>;
  invoke(ch: "file:new"): Promise<string>;
  invoke(ch: "file:openDialog"): Promise<string | null>;
  invoke(ch: "file:saveAsDialog", currentPath: string): Promise<string | null>;
  invoke(ch: "file:pickFolder", current: string): Promise<string | null>;
  invoke(ch: "claude:start", opts: StartOpts): Promise<void>;
  invoke(ch: "claude:send", content: UserContent): Promise<void>;
  invoke(ch: "claude:control", request: Record<string, unknown>): Promise<void>;
  invoke(ch: "claude:respond", requestId: string, response: Record<string, unknown>): Promise<void>;
  invoke(ch: "claude:stop"): Promise<void>;
  invoke(ch: "sessions:list", cwd: string): Promise<SessionInfo[]>;
  invoke(ch: "sessions:transcript", id: string, cwd: string): Promise<any[]>;
  invoke(ch: "share:post", json: string): Promise<{ url: string } | { error: string }>;
  invoke(ch: "shell:terminal", command: string): Promise<void>;
  invoke(ch: "shell:openExternal", url: string): Promise<void>;
  send(ch: "canvas:result", payload: { callId: string; result?: any; error?: string }): void;
  on(ch: "claude:event", cb: (msg: any) => void): () => void;
  on(ch: "canvas:call", cb: (call: CanvasCall) => void): () => void;
}

declare global {
  interface Window {
    api: Api;
  }
}
