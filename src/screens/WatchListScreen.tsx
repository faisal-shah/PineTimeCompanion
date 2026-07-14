import React, { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation';
import { newWatch, useWatchStore } from '../storage/store';
import { colors, spacing } from '../ui/theme';
import { useKeyboardHeight } from '../ui/useKeyboardHeight';
import { Watch } from '../model/types';

type Props = NativeStackScreenProps<RootStackParamList, 'WatchList'>;

function syncStatus(watch: Watch): { label: string; color: string } {
  if (!watch.deviceId) {
    return { label: 'not paired', color: colors.textDim };
  }
  if (watch.syncedVersion === watch.scheduleVersion) {
    return { label: `synced ${watch.lastSyncAt ? new Date(watch.lastSyncAt).toLocaleString() : ''}`, color: colors.accent };
  }
  return { label: 'changes not synced', color: colors.warn };
}

export function WatchListScreen({ navigation }: Props) {
  const { watches, upsertWatch } = useWatchStore();
  const [name, setName] = useState('');
  const insets = useSafeAreaInsets();
  // Keep the input bar above the keyboard when open, and above the nav bar
  // (gesture pill or 3-button) when closed. See useKeyboardHeight.
  const bottomLift = Math.max(insets.bottom, useKeyboardHeight());

  const addWatch = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert('Name the watch first', 'e.g. the name of whoever wears it.');
      return;
    }
    const watch = newWatch(trimmed);
    upsertWatch(watch);
    setName('');
    navigation.navigate('WatchDetail', { watchId: watch.id });
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={watches}
        keyExtractor={(w) => w.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: spacing(2) }}
        ListEmptyComponent={
          <Text style={styles.empty}>
            No watches yet.{'\n'}Add one below to start building its schedule.
          </Text>
        }
        renderItem={({ item }) => {
          const status = syncStatus(item);
          return (
            <Pressable
              style={styles.card}
              onPress={() => navigation.navigate('WatchDetail', { watchId: item.id })}
              testID={`watch-${item.name}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.watchName}>{item.name}</Text>
                <Text style={[styles.status, { color: status.color }]}>{status.label}</Text>
              </View>
              <View style={styles.cardRight}>
                {item.batteryPercent !== undefined && (
                  <Text style={styles.battery}>{item.batteryPercent}%</Text>
                )}
                <Text style={styles.eventCount}>{item.events.length} events</Text>
              </View>
            </Pressable>
          );
        }}
      />
      <View style={[styles.addRow, { marginBottom: bottomLift }]}>
        <TextInput
          style={styles.input}
          placeholder="New watch name"
          placeholderTextColor={colors.textDim}
          value={name}
          onChangeText={setName}
          onSubmitEditing={addWatch}
          returnKeyType="done"
          testID="new-watch-name"
        />
        <Pressable style={styles.addButton} onPress={addWatch} testID="add-watch">
          <Text style={styles.addButtonText}>Add</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  empty: { color: colors.textDim, textAlign: 'center', marginTop: spacing(8), lineHeight: 22 },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: spacing(2),
    marginBottom: spacing(1.5),
    alignItems: 'center',
  },
  watchName: { color: colors.text, fontSize: 18, fontWeight: '600' },
  status: { fontSize: 13, marginTop: 2 },
  cardRight: { alignItems: 'flex-end' },
  battery: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  eventCount: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  addRow: { flexDirection: 'row', padding: spacing(2), gap: spacing(1) },
  input: {
    flex: 1,
    backgroundColor: colors.card,
    color: colors.text,
    borderRadius: 10,
    paddingHorizontal: spacing(2),
    height: 48,
  },
  addButton: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    justifyContent: 'center',
    paddingHorizontal: spacing(3),
  },
  addButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
