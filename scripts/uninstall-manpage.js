#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function isGlobalUninstall() {
  return process.env.npm_config_global === "true";
}

function main() {
  if (!isGlobalUninstall()) return;
  if (process.platform === "win32") return;

  const prefix = process.env.npm_config_prefix;
  if (!prefix) return;

  const manPath = path.join(prefix, "share", "man", "man1", "suno-export.1");
  try {
    if (fs.existsSync(manPath)) {
      fs.unlinkSync(manPath);
      console.log(`Removed man page: ${manPath}`);
    }
  } catch (err) {
    console.warn(`Skipping man page removal: ${err.message}`);
  }
}

main();
