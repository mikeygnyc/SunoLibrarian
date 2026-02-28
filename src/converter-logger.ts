import * as fs from "fs";
import * as path from "path";

let stream: fs.WriteStream | null = null;

/**
 * Initialize the logger. Must be called before any logging occurs.
 *
 * @param outputRoot Directory where the log file will be created.
 *                  A fixed file named `process.log` is used and overwritten
 *                  on each run to avoid accumulating hundreds of files.
 */
export function init(outputRoot: string) {
  try {
    const logPath = path.join(outputRoot, "process.log");
    // ensure directory exists
    fs.mkdirSync(outputRoot, { recursive: true });
    stream = fs.createWriteStream(logPath, { flags: "w" });
    log(`Logging initialized (file: ${logPath})`);
  } catch (err: any) {
    console.error("Failed to initialize log file:", err);
    // if the file can't be opened, continue using console only
    stream = null;
  }
}

function writeToFile(line: string) {
  if (stream) {
    stream.write(line + "\n");
  }
}

function formatMessage(level: string, msg: string) {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] ${level} ${msg}`;
}

export function log(msg: string) {
  const formatted = formatMessage("LOG", msg);
  console.log(msg);
  writeToFile(formatted);
}

export function info(msg: string) {
  const formatted = formatMessage("INFO", msg);
  console.log(msg);
  writeToFile(formatted);
}

export function warn(msg: string) {
  const formatted = formatMessage("WARN", msg);
  console.warn(msg);
  writeToFile(formatted);
}

export function error(msg: string) {
  const formatted = formatMessage("ERROR", msg);
  console.error(msg);
  writeToFile(formatted);
}
