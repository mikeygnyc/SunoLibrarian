import type { IOrchestrationJob } from "./IOrchestrationJob";
import type { IOrchestrationStage } from "./IOrchestrationStage";
import type { IStatusEvent } from "./IStatusEvent";
import type { IWorkItem } from "./IWorkItem";

export interface IJobSnapshot {
  job?: IOrchestrationJob;
  stages: IOrchestrationStage[];
  workItems: IWorkItem[];
  statusEvents: IStatusEvent[];
}
