import { spawn, type ChildProcess } from "child_process";
import net from "node:net";

let launcherPromise: Promise<void> | null = null;
let sidecarProcess: ChildProcess | null = null;

const PORT = 9222;

async function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(500);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, "127.0.0.1");
  });
}

/**
 * Start a locally configured, transparent Obscura sidecar for development.
 * Production must provide a separately managed sidecar through OBSCURA_URL.
 */
export async function ensureObscuraRunning(): Promise<void> {
  if (launcherPromise) {
    return launcherPromise;
  }

  launcherPromise = (async () => {
    const running = await isPortOpen(PORT);
    if (running) {
      console.log(`[Obscura] Sidecar already running on port ${PORT}`);
      return;
    }

    const binPath = process.env.OBSCURA_BIN_PATH || "";
    if (!binPath) {
      throw new Error("Set OBSCURA_BIN_PATH to a verified local sidecar binary.");
    }

    console.log(`[Obscura] Spawning sidecar process from ${binPath}...`);
    const args = ["serve", "--port", String(PORT)];
    
    try {
      sidecarProcess = spawn(binPath, args, {
        detached: true,
        stdio: "ignore",
      });
      sidecarProcess.unref();

      // Poll until port opens
      for (let i = 0; i < 25; i++) {
        await new Promise((r) => setTimeout(r, 200));
        if (await isPortOpen(PORT)) {
          console.log(`[Obscura] Sidecar successfully started on port ${PORT}`);
          return;
        }
      }
      throw new Error(`Obscura sidecar failed to start on port ${PORT} within 5s.`);
    } catch (err) {
      launcherPromise = null;
      throw new Error(`Failed to spawn Obscura process: ${err instanceof Error ? err.message : String(err)}`);
    }
  })();

  return launcherPromise;
}
