// Refuse to e2e a bundle that predates the source.
//
// Both web and desktop e2e drive a pre-exported bundle, and neither used to
// check its age. A desktop run once passed the schedule step against a bundle
// three weeks old, and later failed with "event record must be 39 bytes, got
// 43" -- a defect fixed in the source long before, still present in the bundle.
// The same staleness had also hidden the fact that the desktop script's
// navigation no longer matched the app.
//
// A green e2e must mean the current source works, so compare mtimes and stop.

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const SKIP = new Set(['node_modules', '.git', 'dist', 'dist-web', 'build', '.expo', 'android', 'ios']);

async function newestMtime(dir) {
  let newest = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      newest = Math.max(newest, await newestMtime(full));
    } else if (/\.(ts|tsx|js|jsx|json)$/.test(e.name)) {
      newest = Math.max(newest, (await stat(full)).mtimeMs);
    }
  }
  return newest;
}

/**
 * Throw unless `bundleIndex` is at least as new as everything under `roots`.
 * `rebuildWith` is the command to name in the error.
 */
export async function assertBundleFresh(bundleIndex, roots, rebuildWith) {
  let built;
  try {
    built = (await stat(bundleIndex)).mtimeMs;
  } catch {
    throw new Error(`no bundle at ${bundleIndex} -- run: ${rebuildWith}`);
  }
  let newestSrc = 0;
  for (const r of roots) newestSrc = Math.max(newestSrc, await newestMtime(r));
  if (newestSrc > built) {
    const age = Math.round((newestSrc - built) / 60000);
    throw new Error(
      `bundle is ${age} min older than the source (${bundleIndex}) -- run: ${rebuildWith}`,
    );
  }
}
