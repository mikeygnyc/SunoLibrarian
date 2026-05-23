#!/usr/bin/env node
import { Command } from "commander";
import { resolveOperatorRuntimeConfig } from "../../k8s/operator/config";
import { SunoExportK8sOperator } from "../../k8s/operator/reconciler";
import { installStructuredConsoleBridge, type StructuredConsoleBridgeHandle } from "../../logging";

const program = new Command()
  .name("suno-export-k8s-operator")
  .description("Kubernetes operator for reconciling Suno export runtime deployments")
  .version("1.0.0")
  .option("--namespace <namespace>", "Only watch SunoExportCluster resources in one namespace")
  .option("--poll-interval <ms>", "Reconciliation interval in milliseconds", "15000")
  .option("--crd-group <group>", "Custom resource API group", "suno.mikegales.dev")
  .option("--crd-version <version>", "Custom resource API version", "v1alpha1")
  .option("--crd-plural <plural>", "Custom resource plural name", "sunoexportclusters")
  .action(async (options: Record<string, unknown>) => {
    let logBridge: StructuredConsoleBridgeHandle | undefined;
    try {
      logBridge = installStructuredConsoleBridge({
        service: "k8s-operator",
        role: "operator",
        tags: ["runtime", "k8s", "operator"],
      });
      const config = resolveOperatorRuntimeConfig(options);
      const operator = new SunoExportK8sOperator(config);
      const abortController = new AbortController();

      const handleSignal = (signal: NodeJS.Signals) => {
        console.log(`[k8s-operator] received ${signal}, shutting down`);
        abortController.abort();
      };

      process.once("SIGINT", handleSignal);
      process.once("SIGTERM", handleSignal);

      console.log(
        `[k8s-operator] starting group=${config.customResourceGroup} version=${config.customResourceVersion} plural=${config.customResourcePlural} namespace=${config.namespace ?? "*"}`,
      );
      await operator.run(abortController.signal);
    } catch (error) {
      console.error("[k8s-operator] fatal error:", error instanceof Error ? error.message : error);
      process.exit(1);
    } finally {
      logBridge?.close();
    }
  });

program.parse();
