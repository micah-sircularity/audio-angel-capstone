import React, { useState } from "react";
import { Animated, Platform, Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import { useReducedMotion } from "./use-motion";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
type Props = Omit<PressableProps, "style"> & {
  style?: StyleProp<ViewStyle>;
  feedback?: "press" | "highlight";
};

/** Stable hit area, immediate feedback, and cancellable native press handling. */
export function TactilePressable({ style, feedback = "press", disabled, onPressIn, onPressOut, className, accessibilityState, ...props }: Props) {
  const reduced = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(1));
  const [opacity] = useState(() => new Animated.Value(1));
  const state = { ...accessibilityState, disabled: !!disabled };
  if (Platform.OS === "web") {
    return <Pressable {...props} disabled={disabled}
      aria-disabled={state.disabled} aria-checked={state.checked} aria-selected={state.selected}
      aria-expanded={state.expanded} aria-busy={state.busy}
      onPressIn={onPressIn} onPressOut={onPressOut}
      className={`aa-tactile ${feedback === "highlight" ? "aa-highlight" : ""} ${className ?? ""}`}
      style={[style, disabled && { opacity: 0.4 }]} />;
  }
  const respond = (pressed: boolean) => {
    Animated.spring(scale, { toValue: pressed && !reduced && feedback === "press" ? 0.97 : 1, stiffness: 500, damping: 45, mass: 1, useNativeDriver: true }).start();
    Animated.timing(opacity, { toValue: pressed ? 0.78 : 1, duration: pressed ? 100 : 160, useNativeDriver: true }).start();
  };
  return <AnimatedPressable {...props} disabled={disabled} accessibilityState={state}
    onPressIn={event => { respond(true); onPressIn?.(event); }}
    onPressOut={event => { respond(false); onPressOut?.(event); }}
    style={[style, { opacity: disabled ? 0.4 : opacity, transform: [{ scale }] }]} />;
}
