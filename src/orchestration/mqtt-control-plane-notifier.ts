import { connect, type IClientOptions, type MqttClient } from "mqtt";
import type { WorkerRole } from "../core/contracts";

export const DEFAULT_CONTROL_PLANE_MQTT_TOPIC_PREFIX = "suno-export/control-plane";

type MqttNotifierOptions = {
  mqttUrl?: string;
  mqttTopicPrefix?: string;
};

type TopicWaiter = {
  resolve: (woke: boolean) => void;
};

export class MqttControlPlaneNotifier {
  private client?: MqttClient;
  private readonly subscribedTopics = new Set<string>();
  private readonly topicWaiters = new Map<string, Set<TopicWaiter>>();
  private connectPromise?: Promise<MqttClient>;

  constructor(private readonly options: MqttNotifierOptions = {}) {}

  async start(): Promise<void> {
    await this.ensureConnected();
  }

  async close(): Promise<void> {
    this.connectPromise = undefined;
    this.subscribedTopics.clear();
    this.topicWaiters.clear();

    if (!this.client) {
      return;
    }

    const client = this.client;
    this.client = undefined;
    await new Promise<void>((resolve) => {
      client.end(false, {}, () => resolve());
    });
  }

  async publishLibrarianWakeup(workspaceId: string, requestId: string): Promise<void> {
    const client = await this.ensureConnected();
    const topic = buildLibrarianWakeTopic(workspaceId, this.options.mqttTopicPrefix);
    const payload = JSON.stringify({
      workspaceId,
      requestId,
      requestedAt: new Date().toISOString(),
    });

    await new Promise<void>((resolve, reject) => {
      client.publish(topic, payload, { qos: 1 }, (error?: Error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  async publishWorkerWorkAvailable(
    role: WorkerRole,
    payload: {
      jobId: string;
      stageId: string;
      workItemId: string;
      workflowType: string;
      stageType: string;
    },
  ): Promise<void> {
    const client = await this.ensureConnected();
    const topic = buildWorkerRoleTopic(role, this.options.mqttTopicPrefix);
    await new Promise<void>((resolve, reject) => {
      client.publish(topic, JSON.stringify(payload), { qos: 1 }, (error?: Error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  async waitForLibrarianWakeup(
    workspaceId: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const topic = buildLibrarianWakeTopic(workspaceId, this.options.mqttTopicPrefix);
    await this.subscribe(topic);

    return await new Promise<boolean>((resolve) => {
      const waiter: TopicWaiter = {
        resolve: (woke) => {
          cleanup();
          resolve(woke);
        },
      };
      const waiters = this.topicWaiters.get(topic) ?? new Set<TopicWaiter>();
      waiters.add(waiter);
      this.topicWaiters.set(topic, waiters);

      const timer = setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeoutMs);

      const onAbort = () => {
        cleanup();
        resolve(false);
      };

      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        const activeWaiters = this.topicWaiters.get(topic);
        activeWaiters?.delete(waiter);
        if (activeWaiters && activeWaiters.size === 0) {
          this.topicWaiters.delete(topic);
        }
      };

      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  async waitForWorkerWork(
    role: WorkerRole,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const topic = buildWorkerRoleTopic(role, this.options.mqttTopicPrefix);
    await this.subscribe(topic);

    return await new Promise<boolean>((resolve) => {
      const waiter: TopicWaiter = {
        resolve: (woke) => {
          cleanup();
          resolve(woke);
        },
      };
      const waiters = this.topicWaiters.get(topic) ?? new Set<TopicWaiter>();
      waiters.add(waiter);
      this.topicWaiters.set(topic, waiters);

      const timer = typeof timeoutMs === "number" && timeoutMs >= 0
        ? setTimeout(() => {
          cleanup();
          resolve(false);
        }, timeoutMs)
        : undefined;

      const onAbort = () => {
        cleanup();
        resolve(false);
      };

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
        }
        signal?.removeEventListener("abort", onAbort);
        const activeWaiters = this.topicWaiters.get(topic);
        activeWaiters?.delete(waiter);
        if (activeWaiters && activeWaiters.size === 0) {
          this.topicWaiters.delete(topic);
        }
      };

      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private async subscribe(topic: string): Promise<void> {
    const client = await this.ensureConnected();
    if (this.subscribedTopics.has(topic)) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      client.subscribe(topic, { qos: 1 }, (error: Error | null) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    this.subscribedTopics.add(topic);
  }

  private async ensureConnected(): Promise<MqttClient> {
    if (this.client?.connected) {
      return this.client;
    }

    if (!this.connectPromise) {
      this.connectPromise = this.openClient().catch((error) => {
        this.connectPromise = undefined;
        throw error;
      });
    }

    return await this.connectPromise;
  }

  private async openClient(): Promise<MqttClient> {
    const mqttUrl = resolveRequiredControlPlaneMqttUrl(this.options.mqttUrl);

    const client = connect(mqttUrl, {
      reconnectPeriod: 1000,
    } satisfies IClientOptions);

    client.on("error", (error) => {
      console.warn(`[control-plane] MQTT notifier error: ${error.message}`);
    });

    client.on("message", (topic) => {
      const waiters = this.topicWaiters.get(topic);
      if (!waiters || waiters.size === 0) {
        return;
      }

      for (const waiter of Array.from(waiters)) {
        waiter.resolve(true);
      }
    });

    client.on("close", () => {
      this.subscribedTopics.clear();
    });

    await new Promise<void>((resolve, reject) => {
      const onConnect = () => {
        client.off("error", onError);
        resolve();
      };
      const onError = (error: Error) => {
        client.off("connect", onConnect);
        reject(error);
      };

      client.once("connect", onConnect);
      client.once("error", onError);
    });

    this.client = client;
    return client;
  }
}

export function buildLibrarianWakeTopic(workspaceId: string, mqttTopicPrefix?: string): string {
  const prefix = resolveControlPlaneMqttTopicPrefix(mqttTopicPrefix);
  return `${prefix}/librarian/sync-request/${workspaceId}`;
}

export function buildWorkerRoleTopic(role: WorkerRole, mqttTopicPrefix?: string): string {
  const prefix = resolveControlPlaneMqttTopicPrefix(mqttTopicPrefix);
  return `${prefix}/worker-role/${role}`;
}

export function resolveControlPlaneMqttUrl(mqttUrl?: string): string | undefined {
  const resolved = mqttUrl?.trim()
    || process.env.SUNO_EXPORT_CONTROL_PLANE_MQTT_URL
    || process.env.SUNO_EXPORT_MQTT_URL;

  return resolved && resolved.length > 0 ? resolved : undefined;
}

export function resolveRequiredControlPlaneMqttUrl(mqttUrl?: string): string {
  const resolved = resolveControlPlaneMqttUrl(mqttUrl);
  if (!resolved) {
    throw new Error(
      "MQTT control-plane is required; provide --mqtt-url, runtime.mqttUrl, SUNO_EXPORT_CONTROL_PLANE_MQTT_URL, or SUNO_EXPORT_MQTT_URL",
    );
  }
  return resolved;
}

export function resolveControlPlaneMqttTopicPrefix(mqttTopicPrefix?: string): string {
  return mqttTopicPrefix?.trim()
    || process.env.SUNO_EXPORT_CONTROL_PLANE_MQTT_TOPIC_PREFIX
    || process.env.SUNO_EXPORT_MQTT_TOPIC_PREFIX
    || DEFAULT_CONTROL_PLANE_MQTT_TOPIC_PREFIX;
}
