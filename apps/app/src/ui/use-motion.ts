import React, { createContext, useContext, useEffect, useState } from "react";
import { AccessibilityInfo, Platform } from "react-native";

let keyboardInput = false;
export const isKeyboardInput = () => keyboardInput;

const ReducedMotion = createContext(true);

export function MotionProvider({ children }: React.PropsWithChildren) {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let active = true;
    const onKey = () => { keyboardInput = true; };
    const onPointer = () => { keyboardInput = false; };
    if (Platform.OS === "web") {
      document.addEventListener("keydown", onKey, true);
      document.addEventListener("pointerdown", onPointer, true);
    }
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (active) setReduced(value);
    }).catch(() => {});
    return () => {
      active = false;
      subscription.remove();
      if (Platform.OS === "web") {
        document.removeEventListener("keydown", onKey, true);
        document.removeEventListener("pointerdown", onPointer, true);
      }
    };
  }, []);
  return React.createElement(ReducedMotion.Provider, { value: reduced }, children);
}

export function useReducedMotion() {
  return useContext(ReducedMotion);
}
