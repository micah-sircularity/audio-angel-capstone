import React, { useState, useEffect } from "react";
import { Modal, ScrollView, View, Animated, Easing } from "react-native";
import { useReducedMotion } from "./use-motion";
import { useApp } from "../state/app-state";
import { useTheme } from "./theme";
import { Button, Label, Row, Toggle } from "./components";

const descriptions: Record<string, string> = {
  profanity: "Strong language and profanity.",
  slurs: "Discriminatory or demeaning language.",
  sexual: "Sexual language and themes.",
  drugs: "References to drugs and substance use.",
  violence: "Descriptions of violence or injury.",
};

export function FilterSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const reduced = useReducedMotion();
  const [offset] = useState(() => new Animated.Value(0));
  useEffect(() => {
    offset.stopAnimation();
    if (!visible) return;
    offset.setValue(reduced ? 0 : 32);
    const motion = Animated.timing(offset, { toValue: 0, duration: reduced ? 0 : 300, easing: Easing.out(Easing.exp), useNativeDriver: true });
    motion.start();
    return () => motion.stop();
  }, [visible, reduced, offset]);
  const app = useApp();
  const t = useTheme();
  const [details, setDetails] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#10251f66", justifyContent: "flex-end" }}>
        <Animated.View accessibilityViewIsModal style={{ transform: [{ translateY: offset }], backgroundColor: t.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "88%", width: "100%", maxWidth: 620, alignSelf: "center", padding: 24 }}>
          <Row><Label size={24} bold style={{ flex: 1 }}>Your content preferences</Label><Button secondary onPress={onClose}>Done</Button></Row>
          <Label muted size={12} style={{ marginTop: 8, marginBottom: 16 }}>{app.playback.track.title} · {app.playback.playing ? "Playing" : "Paused"} · simulated</Label>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Label>Choose what you prefer to avoid. Changes apply to this device’s active profile.</Label>
            <Label muted size={12} style={{ marginTop: 8, marginBottom: 16 }}>Design preview: these controls do not establish detection support. Some content may be missed.</Label>
            {app.active.rules.map(rule => (
              <View key={rule.id} style={{ borderTopWidth: 1, borderTopColor: t.border, paddingVertical: 12 }}>
                <Row><View style={{ flex: 1 }}><Label bold>{rule.label === "Cuss words" ? "Strong language" : rule.label}</Label><Label muted size={12}>{descriptions[rule.value] ?? "Content matching your personal preference."}</Label></View><Toggle label={`Avoid ${rule.label}`} value={rule.enabled} onChange={enabled => { app.updateRule(rule.id, { enabled }); setConfirmation(`${rule.label}: ${enabled ? "filter on" : "filter off"}. Preference updated.`); }} /></Row>
                <Button secondary onPress={() => setDetails(details === rule.id ? null : rule.id)}>{details === rule.id ? "Hide details" : "Show details"}</Button>
                {details === rule.id && <Label muted size={12} style={{ marginTop: 8 }}>Preview action: {rule.action === "mute" ? "briefly mute audio" : rule.action === "skip-song" ? "skip the track" : "skip the section"}. Examples are omitted to keep this preview discreet.</Label>}
              </View>
            ))}
          </ScrollView>
          <Label accessibilityLiveRegion="polite" style={{ color: t.primary, minHeight: 44, paddingTop: 12 }} size={12}>{confirmation || `${app.active.rules.filter(r => r.enabled).length} active preferences · ${app.active.name}`}</Label>
          <Button onPress={onClose}>Return to listening</Button>
        </Animated.View>
      </View>
    </Modal>
  );
}
