import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webEnv = fileURLToPath(new URL("../.env.local", import.meta.url));

/** The backend the tests use: E2E_CONVEX_URL, else the dev backend in apps/web/.env.local. */
export const e2eConvexUrl = (): string => {
  const explicit = process.env["E2E_CONVEX_URL"];

  if (explicit !== undefined && explicit.length > 0) return explicit;

  const line = readFileSync(webEnv, "utf8")
    .split("\n")
    .find((entry) => entry.startsWith("VITE_CONVEX_URL="));

  if (line === undefined) throw new Error("Set E2E_CONVEX_URL or run scripts/dev-backend.sh first");

  return line.slice("VITE_CONVEX_URL=".length).trim();
};
