import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const source = path.join(rootDir, "public", "goalie-icon-main.png");
const iconsetDir = path.join(__dirname, "icon.iconset");
const sizes = [16, 32, 128, 256, 512];

cpSync(source, path.join(__dirname, "icon.png"));
cpSync(source, path.join(rootDir, "public", "icon.png"));
cpSync(source, path.join(__dirname, "goalie-icon-main.png"));

rmSync(iconsetDir, { recursive: true, force: true });
mkdirSync(iconsetDir, { recursive: true });

for (const size of sizes) {
  execSync(`sips -z ${size} ${size} "${source}" --out "${path.join(iconsetDir, `icon_${size}x${size}.png`)}"`, {
    stdio: "inherit",
  });
  execSync(
    `sips -z ${size * 2} ${size * 2} "${source}" --out "${path.join(iconsetDir, `icon_${size}x${size}@2x.png`)}"`,
    { stdio: "inherit" },
  );
}

execSync(`iconutil -c icns "${iconsetDir}" -o "${path.join(__dirname, "icon.icns")}"`, { stdio: "inherit" });
rmSync(iconsetDir, { recursive: true, force: true });

console.log("Built desktop/icon.icns from public/goalie-icon-main.png");
