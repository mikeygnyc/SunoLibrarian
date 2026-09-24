import { PostgresControlPlaneRepository } from "./postgres-control-plane";

const SHARED_AUTH_TOKEN_KEY = "auth_token";

type ControlPlaneAuthOptions = {
  postgresUrl?: string;
};

export async function getSharedAuthToken(options: ControlPlaneAuthOptions = {}): Promise<string | undefined> {
  if (typeof options.postgresUrl !== "string" || options.postgresUrl.trim().length === 0) {
    return undefined;
  }

  const repository = new PostgresControlPlaneRepository({
    postgresUrl: options.postgresUrl,
  });

  try {
    const value = await repository.getRuntimeSetting(SHARED_AUTH_TOKEN_KEY);
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
  } finally {
    await repository.close();
  }
}

export async function setSharedAuthToken(options: ControlPlaneAuthOptions = {}, token: string): Promise<void> {
  if (
    typeof options.postgresUrl !== "string"
    || options.postgresUrl.trim().length === 0
    || typeof token !== "string"
    || token.trim().length === 0
  ) {
    return;
  }

  const repository = new PostgresControlPlaneRepository({
    postgresUrl: options.postgresUrl,
  });

  try {
    await repository.setRuntimeSetting(SHARED_AUTH_TOKEN_KEY, token.trim());
  } finally {
    await repository.close();
  }
}

export async function clearSharedAuthToken(options: ControlPlaneAuthOptions = {}): Promise<void> {
  if (typeof options.postgresUrl !== "string" || options.postgresUrl.trim().length === 0) {
    return;
  }

  const repository = new PostgresControlPlaneRepository({
    postgresUrl: options.postgresUrl,
  });

  try {
    await repository.deleteRuntimeSetting(SHARED_AUTH_TOKEN_KEY);
  } finally {
    await repository.close();
  }
}
