import React from "react";
import Svg, { Path } from "react-native-svg";
import { useTheme } from "./theme";
/** A sheltering arc above an audio waveform. */
export function BrandMark() {
  return <Svg width={30} height={30} viewBox="0 0 32 32" accessibilityLabel="Audio Angel"><Path d="M4 16a12 12 0 0 1 24 0M8 20v3m4-8v11m4-15v17m4-13v11m4-6v3" fill="none" stroke={useTheme().primary} strokeWidth={2} strokeLinecap="round" /></Svg>;
}
