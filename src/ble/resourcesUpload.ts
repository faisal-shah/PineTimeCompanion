// Push an InfiniTime external-resources archive to the watch over the BLE
// filesystem: create the parent directories the files need, write every
// resource, then delete the files the release marks obsolete. Reports byte
// progress across the whole set so the UI can show a single bar.

import { WatchTransport } from './transport';
import { FsClient } from './fsClient';
import { ResourcesArchive, parentDirs } from './resourcesZip';

export interface ResourcesProgress {
  phase: 'mkdir' | 'write' | 'cleanup';
  path: string;
  sentBytes: number;
  totalBytes: number;
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
  } finally {
    fs.end();
  }
}
