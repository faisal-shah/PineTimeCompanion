import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput } from 'react-native';
import { colors, spacing } from '../ui/theme';
import { Screen } from '../ui/Screen';
import { Button } from '../ui/Button';
import { DEFAULT_MAP_STYLE_URL, getFindMySettings, saveFindMySettings } from '../storage/findMySettings';
import { DEFAULT_ANISETTE_SERVERS } from '../findmy/apple/anisette';

export function FindMySettingsScreen() {
  const [mapStyleUrl, setMapStyleUrl] = useState('');
  const [anisette, setAnisette] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getFindMySettings().then((s) => {
      setMapStyleUrl(s.mapStyleUrl);
      setAnisette(s.anisetteServers.join('\n'));
    });
  }, []);

  const save = async () => {
    const servers = anisette
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.startsWith('https://'));
    await saveFindMySettings({ mapStyleUrl: mapStyleUrl.trim() || DEFAULT_MAP_STYLE_URL, anisetteServers: servers });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <Screen width="read">
      <Text style={styles.label}>Map style URL</Text>
      <TextInput
        style={styles.input}
        value={mapStyleUrl}
        onChangeText={setMapStyleUrl}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={DEFAULT_MAP_STYLE_URL}
        placeholderTextColor={colors.textDim}
      />
      <Text style={styles.hint}>
        A MapLibre style JSON URL. Default is OpenFreeMap (no signup). To use MapTiler, paste its style URL including your
        ?key=… — e.g. https://api.maptiler.com/maps/streets-v2/style.json?key=YOURKEY
      </Text>
      <Pressable onPress={() => setMapStyleUrl(DEFAULT_MAP_STYLE_URL)}>
        <Text style={styles.reset}>Reset to OpenFreeMap</Text>
      </Pressable>

      <Text style={[styles.label, { marginTop: spacing(3) }]}>Anisette servers (one per line)</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={anisette}
        onChangeText={setAnisette}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        placeholder={DEFAULT_ANISETTE_SERVERS.join('\n')}
        placeholderTextColor={colors.textDim}
      />
      <Text style={styles.hint}>
        Extra https anisette-v3 servers tried before the built-in SideStore list — e.g. point at your own self-hosted
        instance. Leave blank to use the defaults. Public servers can be down; the app falls back across them.
      </Text>

      <Button label={saved ? 'Saved ✓' : 'Save'} onPress={save} style={{ marginTop: spacing(3) }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.textDim, marginBottom: spacing(0.5), fontSize: 13, textTransform: 'uppercase' },
  input: { backgroundColor: colors.card, borderRadius: 10, minHeight: 48, paddingHorizontal: spacing(1.5), paddingVertical: spacing(1), color: colors.text, fontSize: 14 },
  multiline: { minHeight: 110, textAlignVertical: 'top' },
  hint: { color: colors.textDim, fontSize: 12, lineHeight: 17, marginTop: spacing(1) },
  reset: { color: colors.accent, fontSize: 14, marginTop: spacing(1), fontWeight: '600' },
});
