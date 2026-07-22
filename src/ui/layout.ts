import { useWindowDimensions } from 'react-native';

/**
 * Layout is driven by AVAILABLE WIDTH, never by platform. A narrow browser
 * window deserves the phone layout; a wide one (or a tablet) deserves room to
 * breathe. Capping-and-centring on wide is what stops this phone-first app from
 * looking like a phone screen stretched sideways on a desktop.
 *
 * Platform still decides genuine CAPABILITIES elsewhere (Web Bluetooth vs native
 * BLE, DFU reachability, native Find My) — but those are orthogonal to layout
 * and stay as `Platform.*` checks. Layout keys off `useLayout()` only.
 */

/** At/above this width the layout gets room: caps content and lays cards in a grid. */
export const WIDE_BREAKPOINT = 700;

/** A narrow reading column for text, forms and detail — long lines tire the eye. */
export const READ_MAX_WIDTH = 640;

/** The default mid column for simple pages. */
export const CONTENT_MAX_WIDTH = 840;

/** A wide column for card GRIDS (watch list, feature hub, releases). */
export const LIST_MAX_WIDTH = 1160;

/** Target width of one card in a responsive grid; the grid fits as many as it can. */
export const GRID_CARD_MIN_WIDTH = 250;

export interface Layout {
  width: number;
  height: number;
  /** Wide enough to cap content and lay cards across: desktop, or a tablet. */
  isWide: boolean;
  /** One column: phones and narrow browser windows. */
  isCompact: boolean;
}

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;
  return { width, height, isWide, isCompact: !isWide };
}
