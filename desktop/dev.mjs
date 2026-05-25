import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const electronCli = path.join(rootDir, "node_modules", "electron", "cli.js");

const child = spawn(process.execPath, [electronCli, "."], {
  cwd: rootDir,
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (code === null) {
    console.error("Goalie exited with signal", signal);
    process.exit(1);
  }

  process.exit(code);
});
