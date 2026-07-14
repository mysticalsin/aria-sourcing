type EnvironmentPatch = Readonly<Record<string, string | undefined>>;

type EnvironmentSnapshot = {
  existed: boolean;
  key: string;
  value: string | undefined;
};

export type ProcessEnvScope = {
  set: (patch: EnvironmentPatch) => void;
  restore: () => void;
};

function writeEnvironmentValue(key: string, value: string | undefined): void {
  const applied = value === undefined
    ? Reflect.deleteProperty(process.env, key)
    : Reflect.set(process.env, key, value);
  if (!applied) throw new Error(`Unable to update process environment key: ${key}`);
}

export function createProcessEnvScope(keys: readonly string[]): ProcessEnvScope {
  const uniqueKeys = new Set(keys);
  if (keys.length === 0 || uniqueKeys.size !== keys.length || keys.some((key) => key.length === 0)) {
    throw new Error("Process environment scopes require unique, non-empty keys.");
  }

  const snapshots: EnvironmentSnapshot[] = keys.map((key) => ({
    existed: Object.hasOwn(process.env, key),
    key,
    value: process.env[key],
  }));
  let active = true;

  return {
    set(patch: EnvironmentPatch): void {
      if (!active) throw new Error("Process environment scope is already restored.");
      const entries = Object.entries(patch);
      for (const [key, value] of entries) {
        if (!uniqueKeys.has(key)) throw new Error(`Process environment key is outside the scope: ${key}`);
        if (value !== undefined && typeof value !== "string") {
          throw new Error(`Process environment value must be a string or undefined: ${key}`);
        }
      }
      for (const [key, value] of entries) writeEnvironmentValue(key, value);
    },
    restore(): void {
      if (!active) return;
      for (const snapshot of snapshots) {
        writeEnvironmentValue(snapshot.key, snapshot.existed ? snapshot.value : undefined);
      }
      active = false;
    },
  };
}
