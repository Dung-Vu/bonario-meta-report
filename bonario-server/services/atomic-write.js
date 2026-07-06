/**
 * atomic-write.js
 *
 * Crash-safe file writes: write to a temp file in the same directory,
 * then rename. Rename is atomic on POSIX file systems so readers never
 * see a partial file.
 */

import { writeFile, rename, unlink, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { randomBytes } from 'crypto';

export async function atomicWriteJSON(filePath, data) {
  await mkdir(dirname(filePath), { recursive: true });

  const tmpPath = `${filePath}.${randomBytes(6).toString('hex')}.tmp`;
  const json = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

  try {
    await writeFile(tmpPath, json, 'utf8');
    await rename(tmpPath, filePath);
  } catch (err) {
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
}

export async function atomicWriteBuffer(filePath, buffer) {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(tmpPath, buffer);
    await rename(tmpPath, filePath);
  } catch (err) {
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
}

export default { atomicWriteJSON, atomicWriteBuffer };