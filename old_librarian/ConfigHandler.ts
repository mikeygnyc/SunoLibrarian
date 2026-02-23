import * as cfgfile from "../config/config.json";
import { IAppConfig } from "./IAppConfig";
import path from "path";
import * as os from "os";
import { IDownloadHandlingConfig } from "./IDownloadHandlingConfig";
class ConfigHandler {
  constructor() {
    if (cfgfile) {
      this.Config = this.transformPathFields(cfgfile as IAppConfig);
    } else {
      throw new Error("Could not load config file");
    }
  }

  Config!: IAppConfig;
  transformPathFields(obj: IAppConfig): any {
    if (obj === null || typeof obj !== "object") return obj;

    const result: any = {};

    for (const key of Object.keys(obj)) {
      const val = (obj as any)[key];

      if (key.includes("Path")) {
        result[key] = path.resolve(val.replace("~", os.homedir));
        //   } else if (typeof val === "object" && val !== null) {
        //     result[key] = this.transformPathFields(val);
        //   } else {
      } else {
        if (key === "otherLocationConfig") {
          let tempArr: IDownloadHandlingConfig[] = [];
          obj.otherLocationConfig.forEach(
            (otherLocCfg: IDownloadHandlingConfig) => {
              let newCfg: IDownloadHandlingConfig = {
                formats: otherLocCfg.formats,
                directoryPath: path.resolve(
                  otherLocCfg.directoryPath.replace("~", os.homedir)
                ),
              };
              tempArr.push(newCfg);
            }
          );
          result[key]=tempArr;
        } else {
          result[key] = val;
        }
      }
    }

    return result;
  }
}

export let AppConfig = new ConfigHandler().Config;
