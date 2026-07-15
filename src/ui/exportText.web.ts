// Web implementation: download the text as a file via a temporary anchor.
// navigator.share is absent in Electron, so a plain download is the one path
// that works in both plain Chrome and the desktop shell.

export async function exportText(options: { filename: string; title: string; contents: string }): Promise<void> {
  const blob = new Blob([options.contents], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = options.filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    // Delay revocation so the click's navigation can start.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
