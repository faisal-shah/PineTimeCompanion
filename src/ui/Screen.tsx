import React from 'react';
import { ScrollView, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from './theme';
import { CONTENT_MAX_WIDTH, LIST_MAX_WIDTH, READ_MAX_WIDTH, useLayout } from './layout';

export type ScreenWidth = 'read' | 'content' | 'list' | 'full';

/** The max content width for a variant on a WIDE screen; `undefined` = uncapped. */
export function maxWidthFor(width: ScreenWidth, isWide: boolean): number | undefined {
  if (!isWide || width === 'full') return undefined;
  if (width === 'read') return READ_MAX_WIDTH;
  if (width === 'list') return LIST_MAX_WIDTH;
  return CONTENT_MAX_WIDTH;
}

/**
 * A style fragment that caps + centres a content container on a wide screen and
 * is a no-op on a phone. Spread into a `FlatList` `contentContainerStyle` (or any
 * container this component can't own directly).
 */
export function useCapStyle(width: ScreenWidth): ViewStyle {
  const { isWide } = useLayout();
  const maxWidth = maxWidthFor(width, isWide);
  return maxWidth ? { maxWidth, width: '100%', alignSelf: 'center' } : {};
}

/**
 * Screen wrapper. Fills the window with the app background, then lays the content
 * in a column that is capped and centred on a WIDE screen (so a phone-first
 * layout stops looking like a phone stretched sideways) and is simply the whole
 * width on a phone. Owns the standard `spacing(2)` padding and bottom safe-area
 * inset so screens don't repeat it.
 *
 *  - `read`    a narrow reading column — text, forms, detail, settings.
 *  - `content` the default mid column — simple pages.
 *  - `list`    a wide column for card GRIDS that should fill a laptop/desktop.
 *  - `full`    no cap.
 */
export function Screen({
  children,
  scroll = true,
  width = 'content',
  padded = true,
  contentStyle,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  width?: ScreenWidth;
  padded?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const { isWide } = useLayout();
  const insets = useSafeAreaInsets();
  const maxWidth = maxWidthFor(width, isWide);

  const capped: StyleProp<ViewStyle> = [
    padded && { padding: spacing(2), paddingBottom: spacing(2) + insets.bottom },
    maxWidth ? { maxWidth, width: '100%', alignSelf: 'center' } : null,
    // When not scrolling, the capped wrapper must carry flex:1 or a flex child
    // (e.g. a map/chart filling the screen) collapses to zero height.
    !scroll && styles.fill,
    contentStyle,
  ];

  return (
    <View style={styles.root}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag">
          <View style={capped}>{children}</View>
        </ScrollView>
      ) : (
        <View style={styles.fill}>
          <View style={capped}>{children}</View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  fill: { flex: 1 },
  // On wide the inner View centres itself; on a phone it fills. The scroll
  // content grows to fit so short screens don't leave a dead scroll area.
  scrollContent: { flexGrow: 1 },
});
