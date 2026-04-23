import { runConverter } from "../converter";
import type { IConverterRunOptions } from "../lib/interfaces";

export class ConversionService {
  async run(options: IConverterRunOptions): Promise<void> {
    await runConverter(options);
  }
}
