// Build identity footer: "v0.7.0 · 97f2253" on stamped release builds,
// "dev · 97f2253" otherwise. Values are baked at build time by app.config.js
// (CI exports APP_VERSION/GIT_COMMIT/GIT_TAG). Shared by all platforms.

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from './theme';

export function versionLabel(): string {
  const extra = Constants.expoConfig?.extra as { gitCommit?: string; gitTag?: string } | undefined;
  const tag = extra?.gitTag;
  const commit = extra?.gitCommit ?? 'unknown';
  return `${tag || 'dev'} · ${commit}`;
}

export function VersionFooter() {
  const insets = useSafeAreaInsets();
  // Keep the label above the Android gesture pill / iOS home indicator.
  return <Text style={[styles.footer, { paddingBottom: spacing(0.5) + insets.bottom }]}>{versionLabel()}</Text>;
}

const styles = StyleSheet.create({
  footer: {
    color: colors.textDim,
    fontSize: 11,
    textAlign: 'center',
    opacity: 0.7,
    paddingVertical: spacing(0.5),
  },
});
