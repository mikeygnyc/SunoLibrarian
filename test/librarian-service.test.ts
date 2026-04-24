import assert from "node:assert/strict";
import test from "node:test";
import { LibrarianService } from "../src/services/librarian-service";

test("LibrarianService rotates through workspaces one per cycle", async () => {
  const syncedWorkspaceIds: string[] = [];
  const service = new LibrarianService(
    {
      async getAuthenticatedClient() {
        return {
          async getWorkspaces() {
            return [
              { id: "ws-1", name: "Workspace 1" },
              { id: "ws-2", name: "Workspace 2" },
            ];
          },
        };
      },
    } as any,
    {
      async saveWorkspacesToDatabase() {},
      async syncWorkspaceMetadata(_options: unknown, _client: unknown, workspace: { id: string }) {
        syncedWorkspaceIds.push(workspace.id);
        return {
          discoveredTrackCount: 1,
          fetchedMetadataCount: 1,
        };
      },
    } as any,
  );

  await service.runSingleWorkspaceCycle({});
  await service.runSingleWorkspaceCycle({});
  await service.runSingleWorkspaceCycle({});

  assert.deepEqual(syncedWorkspaceIds, ["ws-1", "ws-2", "ws-1"]);
});

test("LibrarianService respects a pinned workspace", async () => {
  const syncedWorkspaceIds: string[] = [];
  const service = new LibrarianService(
    {
      async getAuthenticatedClient() {
        return {
          async getWorkspaces() {
            return [
              { id: "ws-1", name: "Workspace 1" },
              { id: "ws-2", name: "Workspace 2" },
            ];
          },
        };
      },
    } as any,
    {
      async saveWorkspacesToDatabase() {},
      async syncWorkspaceMetadata(_options: unknown, _client: unknown, workspace: { id: string }) {
        syncedWorkspaceIds.push(workspace.id);
        return {
          discoveredTrackCount: 1,
          fetchedMetadataCount: 1,
        };
      },
    } as any,
  );

  await service.runSingleWorkspaceCycle({ workspace: "ws-2" });
  await service.runSingleWorkspaceCycle({ workspace: "ws-2" });

  assert.deepEqual(syncedWorkspaceIds, ["ws-2", "ws-2"]);
});
