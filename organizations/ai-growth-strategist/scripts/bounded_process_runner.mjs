import { spawn } from 'node:child_process';
import process from 'node:process';

export function runBoundedCommand({
  command,
  args,
  cwd,
  label,
  timeoutMs,
  shutdownTimeoutMs = 10_000,
  env,
}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError('timeoutMs must be a positive integer');
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
      env,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timingOut = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };

    const timer = setTimeout(async () => {
      timingOut = true;
      try {
        await terminateProcessTree(child.pid, shutdownTimeoutMs);
        finish(new Error(`${label} timed out after ${timeoutMs}ms`));
      } catch (error) {
        finish(new Error(
          `${label} timed out after ${timeoutMs}ms and process tree shutdown failed: ${error.message}`,
          { cause: error },
        ));
      }
    }, timeoutMs);

    child.once('error', (error) => {
      if (!timingOut) {
        finish(new Error(`${label} failed to start: ${error.message}`));
      }
    });
    child.once('close', (code, signal) => {
      if (timingOut) return;
      if (code !== 0 || signal !== null) {
        finish(new Error(
          `${label} failed: code=${code} signal=${signal ?? 'none'}\n${stdout}\n${stderr}`,
        ));
        return;
      }
      finish(null, { stdout, stderr });
    });
  });
}

async function terminateProcessTree(pid, timeoutMs) {
  if (!Number.isInteger(pid) || pid < 1) return;
  if (process.platform === 'win32') {
    await runTaskkill(pid);
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
  await waitForExit(pid, timeoutMs);
}

function runTaskkill(pid) {
  return new Promise((resolve, reject) => {
    const killer = spawn(
      'taskkill.exe',
      ['/PID', String(pid), '/T', '/F'],
      {
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    killer.once('error', reject);
    killer.once('close', (code) => {
      if (code === 0 || !isAlive(pid)) resolve();
      else reject(new Error(`taskkill exited with code ${code}`));
    });
  });
}

async function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (isAlive(pid)) {
    if (Date.now() >= deadline) {
      throw new Error(`process ${pid} did not exit before shutdown deadline`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}
