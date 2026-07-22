import React from 'react';
import { StyleSheet, View } from 'react-native';
import { spacing } from './theme';
import { GRID_CARD_MIN_WIDTH, useLayout } from './layout';

/**
 * A responsive grid for card-like list items (the feature hub, the watch list,
 * releases). On a wide screen the cards flow into as many columns as fit (each
 * ~GRID_CARD_MIN_WIDTH, capped so a lone card on the last row doesn't stretch);
 * on a phone it's a single full-width column. Give it plain cards — it wraps each.
 */
export function CardGrid({ children }: { children: React.ReactNode }) {
  const { isWide } = useLayout();
  return (
    <View style={styles.grid}>
      {React.Children.map(children, (child) =>
        child == null || child === false ? null : (
          <View style={isWide ? styles.itemWide : styles.itemNarrow}>{child}</View>
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(1.5) },
  itemWide: { flexGrow: 1, flexBasis: GRID_CARD_MIN_WIDTH, maxWidth: 380 },
  itemNarrow: { width: '100%' },
});
