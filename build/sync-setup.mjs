// usage: pnpm sync:setup  (once per Mac; needs the Vercel CLI logged in to the account that owns the project)
// Pulls the Blob store token of the Vercel project into data/app/sync.json (gitignored, mode 600). The app syncs when that file exists.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "explainer-")), ".env");
const env = { ...process.env, VERCEL_ORG_ID: "team_CPHX1knfRFeyur6aspbm0zIJ", VERCEL_PROJECT_ID: "prj_8HCPxB6tkXx6vOK5gZoMPbOG8Iuu" };
try {
  execFileSync("vercel", ["env", "pull", tmp, "--environment", "production", "--yes"], { env, stdio: ["ignore", "ignore", "inherit"] });
  const token = /^BLOB_READ_WRITE_TOKEN="?([^"\n]+)"?$/m.exec(fs.readFileSync(tmp, "utf8"))?.[1];
  if (!token) throw new Error("the project has no BLOB_READ_WRITE_TOKEN (is the Blob store connected?)");
  const out = path.resolve("data/app/sync.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ blobToken: token }, null, 2) + "\n", { mode: 0o600 });
  console.log(`sync on: token saved in ${out}. Restart Explainer.`);
} finally {
  fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
}
