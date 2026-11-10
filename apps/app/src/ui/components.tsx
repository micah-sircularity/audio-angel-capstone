import React, { useEffect, useState } from "react";
import {
  Animated,
  Easing,
  Text,
  View,
  TextInput,
  StyleSheet,
  type TextStyle,
  type TextProps,
  type ViewStyle,
} from "react-native";
import { type IconProps } from "./icons";
import { TactilePressable } from "./tactile-pressable";
import { isKeyboardInput, useReducedMotion } from "./use-motion";
import { fonts, useTheme } from "./theme";
export function Label({
  children,
  muted = false,
  bold = false,
  size = 14,
  style,
  ...textProps
}: React.PropsWithChildren<{
  muted?: boolean;
  bold?: boolean;
  size?: number;
  style?: TextStyle;
} & Pick<TextProps, "accessibilityLiveRegion">>) {
  const t = useTheme();
  return (
    <Text
      {...textProps}
      style={[
        {
          color: muted ? t.muted : t.text,
          fontFamily: bold ? fonts.bold : fonts.regular,
          fontSize: size,
          lineHeight: size * 1.45,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
export function Title({ children }: React.PropsWithChildren) {
  return (
    <Label size={28} bold style={{ letterSpacing: -0.8, marginBottom: 18 }}>
      {children}
    </Label>
  );
}
export function Row({
  children,
  style,
}: React.PropsWithChildren<{ style?: ViewStyle }>) {
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
export function IconButton({
  icon: Icon,
  label,
  onPress,
  prominent = false,
  selected = false,
  disabled = false,
}: {
  icon: React.ComponentType<IconProps>;
  label: string;
  onPress: () => void;
  prominent?: boolean;
  selected?: boolean;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <TactilePressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      disabled={disabled}
      onPress={onPress}
      style={{
        width: prominent ? 64 : 44,
        height: prominent ? 64 : 44,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 32,
        backgroundColor: prominent ? t.button : "transparent",
      }}
    >
      <Icon
        size={prominent ? 28 : 22}
        strokeWidth={1.7}
        color={prominent ? t.buttonText : selected ? t.primary : t.text}
      />
    </TactilePressable>
  );
}
export function Button({
  children,
  onPress,
  secondary = false,
  disabled = false,
}: React.PropsWithChildren<{
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
}>) {
  const t = useTheme();
  return (
    <TactilePressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 44,
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 11,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: secondary ? t.grouped : t.button,
      }}
    >
      <Label bold style={{ color: secondary ? t.text : t.buttonText }}>
        {children}
      </Label>
    </TactilePressable>
  );
}
export function Chip({
  children,
  onPress,
  selected = false,
  disabled = false,
}: React.PropsWithChildren<{ onPress: () => void; selected?: boolean; disabled?: boolean }>) {
  const t = useTheme();
  return (
    <TactilePressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 44,
        paddingHorizontal: 13,
        paddingVertical: 10,
        borderRadius: 9,
        borderWidth: 1,
        borderColor: selected ? t.primary : t.border,
        backgroundColor: t.grouped,
      }}
    >
      <Label size={12} style={{ color: selected ? t.primary : t.text }}>
        {children}
      </Label>
    </TactilePressable>
  );
}
export function Group({ children }: React.PropsWithChildren) {
  const t = useTheme();
  return (
    <View
      style={{
        backgroundColor: t.grouped,
        borderRadius: 12,
        paddingHorizontal: 16,
        marginVertical: 16,
      }}
    >
      {children}
    </View>
  );
}
export function ListRow({
  title,
  description,
  children,
  last = false,
}: React.PropsWithChildren<{
  title: string;
  description?: string;
  last?: boolean;
}>) {
  const t = useTheme();
  return (
    <Row
      style={{
        minHeight: 74,
        paddingVertical: 13,
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: t.border,
      }}
    >
      <View style={{ flex: 1 }}>
        <Label>{title}</Label>
        {description && (
          <Label muted size={12}>
            {description}
          </Label>
        )}
      </View>
      {children}
    </Row>
  );
}
export function Notice({ children }: React.PropsWithChildren) {
  const t = useTheme();
  return (
    <View style={{ padding: 16, borderRadius: 12, backgroundColor: t.grouped }}>
      {children}
    </View>
  );
}
export function Field({
  value,
  onChangeText,
  placeholder,
  label,
  autoFocus = false,
  onSubmitEditing,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  label: string;
  autoFocus?: boolean;
  onSubmitEditing?: () => void;
}) {
  const t = useTheme();
  return (
    <TextInput
      accessibilityLabel={label}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={t.muted}
      autoFocus={autoFocus}
      onSubmitEditing={onSubmitEditing}
      maxLength={120}
      style={{
        backgroundColor: t.grouped,
        borderWidth: 1,
        borderColor: t.border,
        borderRadius: 9,
        color: t.text,
        fontFamily: fonts.regular,
        fontSize: 14,
        paddingHorizontal: 13,
        paddingVertical: 13,
        minHeight: 46,
      }}
    />
  );
}
export function Toggle({ value, onChange, label }: { value: boolean; onChange: (value: boolean) => void; label: string }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const [position] = useState(() => new Animated.Value(value ? 1 : 0));
  useEffect(() => {
    const instant = reduced || isKeyboardInput();
    const animation = Animated.timing(position, { toValue: value ? 1 : 0, duration: instant ? 0 : 180, easing: Easing.bezier(0.23, 1, 0.32, 1), useNativeDriver: false });
    animation.start();
    return () => animation.stop();
  }, [value, reduced, position]);
  return (
    <TactilePressable accessibilityRole="switch" accessibilityLabel={label}
      accessibilityState={{ checked: value }} feedback="highlight"
      onPress={() => onChange(!value)}
      style={{ width: 54, minHeight: 44, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={{ width: 50, height: 30, borderRadius: 15, padding: 3,
        backgroundColor: position.interpolate({ inputRange: [0, 1], outputRange: [t.muted, t.primary] }) }}>
        <Animated.View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: "#ffffff",
          transform: [{ translateX: position.interpolate({ inputRange: [0, 1], outputRange: [0, 20] }) }] }} />
      </Animated.View>
    </TactilePressable>
  );
}
