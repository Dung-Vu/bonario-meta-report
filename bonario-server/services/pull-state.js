/**
 * pull-state.js
 *
 * Persistent pull state — survives process restarts via .bonario.lock file.
 * If the server dies mid-pull and restarts, the next process can detect
 * the stale lock and either resume or reset.
 */

import { readFile, writeFile, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { atomicWriteJSON } from './atomic-write.js';

const STALE_LOCK_MS = 30 * 60 * 1000; // 30 min

export function createPullStateStore(dataDir, lockName = '.bonario.lock') {
  const lockPath = path.join(dataDir, lockName);

  let memState = {
    isPulling: false,
    lastPullId: null,
    lastPullTimestamp: null,
    lastPullError: null,
    startedAt: null,
    pid: null
  };

  async function loadFromDisk() {
    try {
      const raw = await readFile(lockPath, 'utf8');
      const parsed = JSON.parse(raw);

      if (parsed.isPulling && parsed.pid !== process.pid) {
        const age = Date.now() - new Date(parsed.startedAt).getTime();
        if (age > STALE_LOCK_MS) {
          console.warn(`[Bonario] Discarding stale pull lock from pid=${parsed.pid} age=${Math.round(age / 1000)}s`);
          parsed.isPulling = false;
        }
      }
      memState = { ...memState, ...parsed };
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn('[Bonario] Failed to load pull state:', err.message);
    }
  }

  async function flush() {
    try {
      await atomicWriteJSON(lockPath, memState);
    } catch (err) {
      console.warn('[Bonario] Failed to persist pull state:', err.message);
    }
  }

  return {
    async init() {
      await loadFromDisk();
    },
    get() {
      return { ...memState };
    },
    async update(patch) {
      memState = { ...memState, ...patch };
      await flush();
      return { ...memState };
    },
    async clear() {
      try {
        if (existsSync(lockPath)) await unlink(lockPath);
      } catch {}
      memState = {
        isPulling: false,
        lastPullId: null,
        lastPullTimestamp: null,
        lastPullError: null,
        startedAt: null,
        pid: null
      };
    }
  };
}

export default { createPullStateStore };