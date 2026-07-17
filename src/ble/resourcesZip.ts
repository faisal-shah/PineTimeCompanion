// Parse an InfiniTime external-resources archive (infinitime-resources-*.zip)
// into the list of files to flash and the obsolete files to delete. The zip
// carries resources.json (see doc/ExternalResources.md):
//   { "resources":     [{ "filename": "x.bin", "path": "/fonts/x.bin" }],
//     "obsolete_files": [{ "path": "/old.bin", "since": "1.11.0" }] }
// `filename` names the entry inside the zip; `path` is where it lands in the
// watch filesystem. We extract the bytes for each named resource up front.

import { unzipSync } from 'fflate';

export interface ResourceFile {
  path: string; // absolute path in the watch FS, e.g. /fonts/lv_font_dots_40.bin
  data: Uint8Array; // the file contents from the zip
}

export interface ResourcesArchive {
  files: ResourceFile[];
  obsolete: string[]; // watch-FS paths to delete
}

interface ResourcesManifest {
  resources?: { filename?: string; path?: string }[];
  obsolete_files?: { path?: string }[];
}

export function parseResourcesArchive(zipBytes: Uint8Array): ResourcesArchive {
  const entries = unzipSync(zipBytes);
  const manifestRaw = entries['resources.json'];
  if (!manifestRaw) {
    throw new Error('Not a resources archive: resources.json missing');
  }
  const manifest = JSON.parse(new TextDecoder().decode(manifestRaw)) as ResourcesManifest;

  const files: ResourceFile[] = [];
  for (const r of manifest.resources ?? []) {
    if (!r.filename || !r.path) {
      throw new Error('resources.json entry missing filename/path');
    }
    const data = entries[r.filename];
    if (!data) {
      throw new Error(`resources archive missing ${r.filename}`);
    }
    files.push({ path: r.path, data });
  }

  const obsolete = (manifest.obsolete_files ?? []).map((o) => o.path).filter((p): p is string => !!p);
  return { files, obsolete };
}

// Unique parent directories that must exist before writing (LFS_O_CREAT does not
// create parents). Ordered shallow-to-deep so /a exists before /a/b.
export function parentDirs(paths: string[]): string[] {
  const dirs = new Set<string>();
  for (const p of paths) {
    const parts = p.split('/').filter(Boolean);
    parts.pop(); // drop the filename
    let acc = '';
    for (const part of parts) {
      acc += `/${part}`;
      dirs.add(acc);
    }
  }
  return [...dirs].sort((a, b) => a.length - b.length);
}
