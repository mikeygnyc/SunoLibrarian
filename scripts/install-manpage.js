#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function isGlobalInstall() {
  return process.env.npm_config_global === "true";
}

function hasManCommand() {
  const result = spawnSync("sh", ["-lc", "command -v man >/dev/null 2>&1"], {
    stdio: "ignore",
  });
  return result.status === 0;
}

function main() {
  if (!isGlobalInstall()) return;
  if (process.platform === "win32") return;
  if (!hasManCommand()) return;

  const prefix = process.env.npm_config_prefix;
  if (!prefix) return;

  const source = path.resolve(__dirname, "..", "man", "suno-export.1");
  const manDir = path.join(prefix, "share", "man", "man1");
  const dest = path.join(manDir, "suno-export.1");

  if (!fs.existsSync(source)) return;

  try {
    fs.mkdirSync(manDir, { recursive: true });
    fs.copyFileSync(source, dest);
    console.log(`Installed man page: ${dest}`);
  } catch (err) {
    console.warn(`Skipping man page install: ${err.message}`);
  }
}

main();
