import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation';
import { useWatchStore } from '../storage/store';
import { colors, spacing } from '../ui/theme';
import { showAlert } from '../ui/alert';
import { makeTransport, isSimulatorDeviceId } from '../ble/transportFactory';
import { getUpdateSettings, saveUpdateSettings, DEFAULT_UPDATE_REPO } from '../updates/updateSettings';
import { fetchReleases, downloadAsset, Release } from '../updates/githubReleases';
import { readFirmwareRevision, runFirmwareUpdate, runResourcesUpdate, DfuDisabledError } from '../updates/updateRunner';

type Props = NativeStackScreenProps<RootStackParamList, 'Update'>;

interface Progress {
  label: string;
  pct: number; // 0..100
}

export function UpdateScreen({ route }: Props) {
  const { watches } = useWatchStore();
  const watch = watches.find((w) => w.id === route.params.watchId);
  const insets = useSafeAreaInsets();

  const [repo, setRepo] = useState(DEFAULT_UPDATE_REPO);
  const [showPrereleases, setShowPrereleases] = useState(false);
  const [repoEditOpen, setRepoEditOpen] = useState(false);
  const [repoDraft, setRepoDraft] = useState('');
  const [firmwareRev, setFirmwareRev] = useState<string | null>(null);
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [validateFor, setValidateFor] = useState<string | null>(null);

  const deviceId = watch?.deviceId;
  const paired = !!deviceId;
  // Real Web Bluetooth cannot reach the DFU service (Chromium blocklist); the
  // sim bridge (ws) and native BLE can. Resources work everywhere.
  const firmwareSupported = !!deviceId && (isSimulatorDeviceId(deviceId) || Platform.OS !== 'web');

  const loadReleases = useCallback(async (r: string) => {
    setReleases(null);
    setLoadError(null);
    try {
      setReleases(await fetchReleases(r));
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    getUpdateSettings().then((s) => {
      setRepo(s.repo);
      setShowPrereleases(s.showPrereleases);
      void loadReleases(s.repo);
    });
  }, [loadReleases]);

  const togglePrereleases = (value: boolean) => {
    setShowPrereleases(value);
    void saveUpdateSettings({ showPrereleases: value });
  };

  const readRevision = useCallback(async () => {
    if (!deviceId) return;
    try {
      setFirmwareRev(await readFirmwareRevision(makeTransport(deviceId), deviceId));
    } catch {
      setFirmwareRev(null);
    }
  }, [deviceId]);

  useEffect(() => {
    void readRevision();
  }, [readRevision]);

  const saveRepo = async () => {
    try {
      await saveUpdateSettings({ repo: repoDraft });
      setRepo(repoDraft.trim());
      setRepoEditOpen(false);
      void loadReleases(repoDraft.trim());
    } catch (e) {
      showAlert('Invalid repository', (e as Error).message);
    }
  };

  const flashFirmware = (release: Release) => {
    if (!deviceId || !release.dfuUrl) return;
    showAlert(
      `Flash firmware ${release.version}?`,
      'The watch will reboot into the new firmware. You must then tap Validate on the watch to keep it — otherwise the next reboot rolls it back.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Flash',
          onPress: () => {
            setValidateFor(null);
            void runStep(async () => {
              const bytes = await downloadAsset(release.dfuUrl!, (recv, total) =>
                setProgress({ label: 'Downloading firmware', pct: total ? (recv / total) * 100 : 0 }),
              );
              await runFirmwareUpdate(makeTransport(deviceId), deviceId, bytes, (p) =>
                setProgress({
                  label: p.phase === 'transfer' ? 'Flashing firmware' : `Firmware: ${p.phase}`,
                  pct: p.total ? (p.sent / p.total) * 100 : 0,
                }),
              );
              setValidateFor(release.version);
            });
          },
        },
      ],
    );
  };

  const uploadResources = (release: Release) => {
    if (!deviceId || !release.resourcesUrl) return;
    void runStep(async () => {
      const bytes = await downloadAsset(release.resourcesUrl!, (recv, total) =>
        setProgress({ label: 'Downloading resources', pct: total ? (recv / total) * 100 : 0 }),
      );
      await runResourcesUpdate(makeTransport(deviceId), deviceId, bytes, (p) =>
        setProgress({ label: `Uploading resources (${p.phase})`, pct: p.totalBytes ? (p.sentBytes / p.totalBytes) * 100 : 0 }),
      );
      showAlert('Resources uploaded', `${release.version} resources are on ${watch?.name ?? 'the watch'}.`);
    });
  };

  const runStep = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      if (e instanceof DfuDisabledError) {
        showAlert('Turn on firmware updates', e.message);
      } else {
        showAlert('Update failed', (e as Error).message);
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const recheckAfterValidate = () =>
    void runStep(async () => {
      await readRevision();
      const now = await readFirmwareRevision(makeTransport(deviceId!), deviceId!);
      setFirmwareRev(now);
      if (validateFor && now === validateFor) {
        setValidateFor(null);
        showAlert('Update confirmed', `The watch is now running ${now}.`);
      } else {
        showAlert(
          'Not confirmed yet',
          `The watch reports ${now || 'an unknown version'}. If you rebooted without tapping Validate, it rolled back — re-flash and validate on the watch.`,
        );
      }
    });

  if (!watch) return null;

  const shownReleases = releases?.filter((r) => showPrereleases || !r.prerelease);
  const hiddenPrereleases = releases ? releases.length - (shownReleases?.length ?? 0) : 0;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing(2), paddingBottom: spacing(2) + insets.bottom }}>
        {/* Current firmware */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Installed firmware</Text>
          <View style={styles.revRow}>
            <Text style={styles.rev} testID="current-firmware">
              {firmwareRev ?? (paired ? '—' : 'Not paired')}
            </Text>
            {paired && (
              <Pressable onPress={() => void readRevision()} testID="reread-firmware">
                <Text style={styles.link}>Re-read</Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* Repo source */}
        <Pressable
          style={styles.repoRow}
          onPress={() => {
            setRepoDraft(repo);
            setRepoEditOpen(true);
          }}
          testID="edit-repo">
          <View style={{ flex: 1 }}>
            <Text style={styles.cardLabel}>Release source</Text>
            <Text style={styles.repoText}>{repo}</Text>
          </View>
          <Text style={styles.link}>Change</Text>
        </Pressable>

        {/* Validate reminder after a firmware flash */}
        {validateFor && (
          <View style={[styles.card, styles.validateCard]} testID="validate-card">
            <Text style={styles.validateTitle}>⚠️ Validate on the watch</Text>
            <Text style={styles.validateBody}>
              The watch is rebooting into {validateFor}. To keep it: on the watch open{' '}
              <Text style={styles.bold}>Settings ▸ Firmware</Text> and tap <Text style={styles.bold}>Validate</Text>. If you skip
              this, the next reboot rolls back to the old version.
            </Text>
            <Pressable style={styles.button} onPress={recheckAfterValidate} disabled={busy} testID="recheck">
              <Text style={styles.buttonText}>I validated — re-check</Text>
            </Pressable>
          </View>
        )}

        {!firmwareSupported && paired && (
          <Text style={styles.note} testID="firmware-unsupported-note">
            Firmware updates need the Android app — a web browser's Bluetooth can't reach the update service. You can still
            upload resources below.
          </Text>
        )}
        {!paired && <Text style={styles.note}>Pair this watch to check for and install updates.</Text>}

        {/* Progress */}
        {progress && (
          <View style={styles.card} testID="update-progress">
            <Text style={styles.progressLabel}>
              {progress.label} · {Math.floor(progress.pct)}%
            </Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.max(2, Math.min(100, progress.pct))}%` }]} />
            </View>
          </View>
        )}

        {/* Releases */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionLabel}>Available releases</Text>
          <View style={styles.preToggle}>
            <Text style={styles.preToggleLabel}>Show pre-releases</Text>
            <Switch value={showPrereleases} onValueChange={togglePrereleases} testID="toggle-prereleases" />
          </View>
        </View>
        {loadError && (
          <View style={styles.card}>
            <Text style={styles.errorText} testID="releases-error">
              {loadError}
            </Text>
            <Pressable style={styles.button} onPress={() => void loadReleases(repo)}>
              <Text style={styles.buttonText}>Retry</Text>
            </Pressable>
          </View>
        )}
        {!loadError && releases === null && <ActivityIndicator color={colors.accent} style={{ marginTop: spacing(2) }} />}
        {shownReleases?.length === 0 &&
          (hiddenPrereleases > 0 ? (
            <Text style={styles.note} testID="only-prereleases-note">
              {hiddenPrereleases} pre-release{hiddenPrereleases > 1 ? 's' : ''} hidden. Turn on “Show pre-releases” above to
              install {hiddenPrereleases > 1 ? 'them' : 'it'}.
            </Text>
          ) : (
            <Text style={styles.note}>No installable releases found in {repo}.</Text>
          ))}
        {shownReleases?.map((r) => (
          <View key={r.tag} style={styles.card} testID={`release-${r.version}`}>
            <View style={styles.releaseHead}>
              <Text style={styles.releaseVersion}>{r.version}</Text>
              {r.version === firmwareRev && <Text style={styles.installedTag}>installed</Text>}
              {r.prerelease && <Text style={styles.preTag}>pre-release</Text>}
            </View>
            <Text style={styles.releaseDate}>{new Date(r.publishedAt).toLocaleDateString()}</Text>
            <View style={styles.releaseButtons}>
              {r.dfuUrl && firmwareSupported && (
                <Pressable
                  style={[styles.smallButton, busy && styles.disabled]}
                  onPress={() => flashFirmware(r)}
                  disabled={busy}
                  testID={`flash-fw-${r.version}`}>
                  <Text style={styles.smallButtonText}>Flash firmware</Text>
                </Pressable>
              )}
              {r.resourcesUrl && paired && (
                <Pressable
                  style={[styles.smallButtonAlt, busy && styles.disabled]}
                  onPress={() => uploadResources(r)}
                  disabled={busy}
                  testID={`upload-res-${r.version}`}>
                  <Text style={styles.smallButtonAltText}>Upload resources</Text>
                </Pressable>
              )}
            </View>
          </View>
        ))}
      </ScrollView>

      <Modal visible={repoEditOpen} transparent animationType="fade" onRequestClose={() => setRepoEditOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Release source</Text>
            <Text style={styles.modalHint}>A GitHub "owner/repo" whose releases carry the InfiniTime DFU + resources zips.</Text>
            <TextInput
              style={styles.input}
              value={repoDraft}
              onChangeText={setRepoDraft}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={DEFAULT_UPDATE_REPO}
              placeholderTextColor={colors.textDim}
              testID="repo-input"
            />
            <View style={styles.modalButtons}>
              <Pressable onPress={() => setRepoEditOpen(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.button} onPress={() => void saveRepo()} testID="repo-save">
                <Text style={styles.buttonText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: spacing(2), marginBottom: spacing(1.5) },
  cardLabel: { color: colors.textDim, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  revRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing(0.5) },
  rev: { color: colors.text, fontSize: 22, fontWeight: '700' },
  link: { color: colors.accent, fontSize: 14, fontWeight: '600' },

  repoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: spacing(2),
    marginBottom: spacing(1.5),
  },
  repoText: { color: colors.text, fontSize: 16, marginTop: spacing(0.5) },

  validateCard: { borderWidth: 1, borderColor: colors.warn },
  validateTitle: { color: colors.warn, fontSize: 16, fontWeight: '700', marginBottom: spacing(1) },
  validateBody: { color: colors.text, fontSize: 14, lineHeight: 20 },
  bold: { fontWeight: '700' },

  note: { color: colors.textDim, fontSize: 14, lineHeight: 20, marginBottom: spacing(1.5) },

  progressLabel: { color: colors.text, fontSize: 14, marginBottom: spacing(1) },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: colors.background, overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.accent },

  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing(1),
    marginBottom: spacing(1),
  },
  sectionLabel: {
    color: colors.textDim,
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  preToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing(1) },
  preToggleLabel: { color: colors.textDim, fontSize: 13 },
  errorText: { color: colors.danger, fontSize: 14, marginBottom: spacing(1) },

  releaseHead: { flexDirection: 'row', alignItems: 'center', gap: spacing(1) },
  releaseVersion: { color: colors.text, fontSize: 18, fontWeight: '700' },
  installedTag: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  preTag: { color: colors.warn, fontSize: 12, fontWeight: '600' },
  releaseDate: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  releaseButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(1), marginTop: spacing(1.5) },
  smallButton: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: spacing(1), paddingHorizontal: spacing(2) },
  smallButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  smallButtonAlt: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 10,
    paddingVertical: spacing(1),
    paddingHorizontal: spacing(2),
  },
  smallButtonAltText: { color: colors.accent, fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.4 },

  button: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: spacing(1.25), paddingHorizontal: spacing(3), alignItems: 'center', marginTop: spacing(1.5) },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing(2) },
  modalCard: { backgroundColor: colors.card, borderRadius: 14, padding: spacing(2), width: '100%', maxWidth: 440 },
  modalTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: spacing(1) },
  modalHint: { color: colors.textDim, fontSize: 13, lineHeight: 18, marginBottom: spacing(1.5) },
  input: { backgroundColor: colors.background, borderRadius: 10, minHeight: 48, paddingHorizontal: spacing(1.5), color: colors.text, fontSize: 15 },
  modalButtons: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing(3), marginTop: spacing(1.5) },
  cancelText: { color: colors.textDim, fontSize: 15, fontWeight: '600' },
});
