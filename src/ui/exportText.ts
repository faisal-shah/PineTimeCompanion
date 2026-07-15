// Cross-platform "hand this text file to the user" seam. Native: the OS share
// sheet (how the .keys export has always worked). Web: a Blob download.

import { Share } from 'react-native';

export async function exportText(options: { filename: string; title: string; contents: string }): Promise<void> {
  await Share.share({ title: options.title, message: options.contents });
}
