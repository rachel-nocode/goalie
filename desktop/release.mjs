import { execSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sign } from "@electron/osx-sign";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const version = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8")).version;
const signIdentity = "Developer ID Application: Rachel Larralde (5U92RP4C5J)";
const notaryProfile = process.env.GOALIE_NOTARY_PROFILE || "maxxtoken-notary";
const arch = process.env.GOALIE_ARCH || "arm64";
const distDir = path.join(rootDir, "desktop-dist");
const appBundleName = "Goalie.app";
const packedDir = path.join(distDir, `Goalie-darwin-${arch}`);
const appPath = path.join(packedDir, appBundleName);
const releaseDir = path.join(rootDir, "release");
const dmgName = `Goalie-${version}-mac-${arch}.dmg`;
const dmgPath = path.join(releaseDir, dmgName);
const notarizeScript = path.join(process.env.HOME || "", ".claude/scripts/notarize.sh");

function run(command, options = {}) {
  console.log(`\n→ ${command}`);
  execSync(command, { stdio: "inherit", cwd: rootDir, ...options });
}

function fixAppIcon(bundlePath) {
  const resourcesDir = path.join(bundlePath, "Contents/Resources");
  const plistPath = path.join(bundlePath, "Contents/Info.plist");
  const sourceIcon = path.join(__dirname, "icon.icns");
  const targetIcon = path.join(resourcesDir, "goalie.icns");
  const legacyIcon = path.join(resourcesDir, "electron.icns");

  if (existsSync(legacyIcon)) {
    rmSync(targetIcon, { force: true });
    cpSync(legacyIcon, targetIcon);
    rmSync(legacyIcon, { force: true });
  } else if (!existsSync(targetIcon) && existsSync(sourceIcon)) {
    cpSync(sourceIcon, targetIcon);
  }

  let plist = readFileSync(plistPath, "utf8");
  plist = plist.replace(
    /<key>CFBundleIconFile<\/key>\s*<string>[^<]+<\/string>/,
    "<key>CFBundleIconFile</key>\n\t<string>goalie</string>",
  );
  writeFileSync(plistPath, plist);
  console.log("Updated app icon to goalie.icns");
}

async function signApp(bundlePath) {
  const entitlements = path.join(__dirname, "entitlements.mac.plist");
  await sign({
    app: bundlePath,
    identity: signIdentity,
    hardenedRuntime: true,
    entitlements,
    "entitlements-inherit": entitlements,
  });
  run(`codesign --verify --deep --strict --verbose=2 "${bundlePath}"`);
}

function createDmg(bundlePath, outputPath) {
  const stagingDir = mkdtempSync(path.join(tmpdir(), "goalie-dmg-"));
  execSync(`ditto "${bundlePath}" "${path.join(stagingDir, appBundleName)}"`);
  execSync(`ln -s /Applications "${path.join(stagingDir, "Applications")}"`);

  rmSync(outputPath, { force: true });
  run(
    `hdiutil create -volname "Goalie" -srcfolder "${stagingDir}" -ov -format UDZO "${outputPath}"`,
  );
  rmSync(stagingDir, { recursive: true, force: true });
}

function signDmg(targetPath) {
  run(`codesign --force --sign "${signIdentity}" --timestamp "${targetPath}"`);
}

function notarize(targetPath) {
  if (!existsSync(notarizeScript)) {
    throw new Error(`Notarize script not found at ${notarizeScript}`);
  }

  const result = spawnSync(notarizeScript, [targetPath, notaryProfile], {
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error("Notarization failed.");
  }
}

mkdirSync(releaseDir, { recursive: true });

run("npm run icons:build");
run(
  `npx electron-packager . Goalie --platform=darwin --arch=${arch} --out="${distDir}" --overwrite --prune=true --ignore=desktop-dist --ignore=release --ignore=.git --ignore=netlify --app-bundle-id=io.goalie.app --app-version=${version} --icon=desktop/icon`,
);

if (!existsSync(appPath)) {
  throw new Error(`Expected app bundle at ${appPath}`);
}

fixAppIcon(appPath);
await signApp(appPath);
notarize(appPath);
createDmg(appPath, dmgPath);
signDmg(dmgPath);
notarize(dmgPath);

console.log(`\nRelease ready:\n  App: ${appPath}\n  DMG: ${dmgPath}\n`);
