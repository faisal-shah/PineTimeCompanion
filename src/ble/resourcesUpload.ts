// Push an InfiniTime external-resources archive to the watch over the BLE
// filesystem: create the parent directories the files need, write every
// resource, then delete the files the release marks obsolete. Reports byte
// progress across the whole set so the UI can show a single bar.

import { WatchTransport } from './transport';
import { FsClient } from './fsClient';
import { ResourcesArchive, parentDirs } from './resourcesZip';

export interface ResourcesProgress {
  phase: 'mkdir' | 'write' | 'cleanup' | 'verify';
  path: string;
  sentBytes: number;
  totalBytes: number;
}

/**
 * Compare what we meant to write against what the watch reports. Returns null
 * when every file is present at its full size, else a message naming what is
 * wrong. Pure, so the comparison is testable without a watch.
 */
export function describeMissing(wanted: Map<string, number>, seen: Map<string, number>): string | null {
  const bad = [...wanted].filter(([path, size]) => seen.get(path) !== size);
  if (bad.length === 0) {
    return null;
  }
  const detail = bad
    .map(([path, size]) => {
      const got = seen.get(path);
      return got === undefined ? `${path} (missing)` : `${path} (${got} bytes, expected ${size})`;
    })
    .join(', ');
  return `the watch is missing ${bad.length} of ${wanted.size} resource files: ${detail}`;
}

export async function uploadResources(
  transport: WatchTransport,
  archive: ResourcesArchive,
  onProgress?: (p: ResourcesProgress) => void,
): Promise<void> {
  const fs = new FsClient(transport);
  await fs.begin();
  try {
    const totalBytes = archive.files.reduce((n, f) => n + f.data.length, 0);
    let doneBytes = 0;

    // Directories first, shallow-to-deep (mkdir tolerates already-exists).
    for (const dir of parentDirs(archive.files.map((f) => f.path))) {
      onProgress?.({ phase: 'mkdir', path: dir, sentBytes: doneBytes, totalBytes });
      await fs.makeDir(dir);
    }

    for (const file of archive.files) {
      const base = doneBytes;
      await fs.writeFile(file.path, file.data, (sent) => {
        onProgress?.({ phase: 'write', path: file.path, sentBytes: base + sent, totalBytes });
      });
      doneBytes += file.data.length;
    }

    for (const path of archive.obsolete) {
      onProgress?.({ phase: 'cleanup', path, sentBytes: doneBytes, totalBytes });
      await fs.deleteFile(path);
    }

    // Read the directories back and confirm every file arrived at its full
    // size. Reported from hardware: an upload stopped partway, the watch was
    // left without /fonts/lv_font_dots_40.bin, and the Casio face rendered an
    // empty box where the day and week go -- while the app said "Resources
    // uploaded". A write that is never checked is not a write.
    onProgress?.({ phase: 'verify', path: '', sentBytes: doneBytes, totalBytes });
    const wanted = new Map(archive.files.map((f) => [f.path, f.data.length]));
    const seen = new Map<string, number>();
    for (const dir of parentDirs(archive.files.map((f) => f.path))) {
      for (const entry of await fs.listDir(dir)) {
        if (!entry.isDirectory) {
          seen.set(`${dir === '/' ? '' : dir}/${entry.path}`.replace('//', '/'), entry.size);
        }
      }
    }
    const problem = describeMissing(wanted, seen);
    if (problem !== null) {
      throw new Error(problem);
    }
  } finally {
    fs.end();
  }
}
