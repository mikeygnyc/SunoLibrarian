import * as os from "os";
import * as path from "path";

export const DEFAULT_DOWNLOAD_ROOT = path.join(os.homedir(), "Downloads", "suno-export");
export const DEFAULT_DATABASE_PATH = path.resolve("data", "suno-export.sqlite");
