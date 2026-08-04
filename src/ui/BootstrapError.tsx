// Shown when the stored watch list could not be read at startup.
//
// This is deliberately a dead end. The app persists whatever it holds in state,
// so carrying on with an empty list would write that empty list straight over
// the stored one -- and that list carries the schedule and task sync base,
// which is the only copy of a watch's data while its firmware is being
// replaced. Stopping here leaves the stored data untouched.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from './theme';

export function BootstrapError() {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Saved watches could not be read</Text>
      <Text style={styles.body}>
        Your watches and their synced schedules have not been changed. Close the app and open it again.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: spacing(3),
  },
  heading: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: spacing(1.5),
    textAlign: 'center',
  },
  body: {
    color: colors.textDim,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
});
