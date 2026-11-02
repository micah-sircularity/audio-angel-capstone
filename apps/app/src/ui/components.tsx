import React from "react";
import {
  Pressable,
  Text,
  View,
  TextInput,
  StyleSheet,
  type TextStyle,
  type TextProps,
  type ViewStyle,
} from "react-native";
import { IconMusic, IconShieldCheck, type IconProps } from "./icons";
import type { Track } from "@audio-angel/contracts";
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
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: prominent ? 56 : 44,
        height: prominent ? 56 : 44,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 30,
        backgroundColor: prominent ? t.button : "transparent",
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <Icon
        size={prominent ? 25 : 22}
        strokeWidth={1.7}
        color={prominent ? t.buttonText : selected ? t.primary : t.text}
      />
    </Pressable>
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
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        borderRadius: 9,
        paddingHorizontal: 16,
        paddingVertical: 11,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: secondary ? t.grouped : t.button,
        opacity: disabled ? 0.4 : pressed ? 0.65 : 1,
      })}
    >
      <Label bold style={{ color: secondary ? t.text : t.buttonText }}>
        {children}
      </Label>
    </Pressable>
  );
}
export function Chip({
  children,
  onPress,
  selected = false,
}: React.PropsWithChildren<{ onPress: () => void; selected?: boolean }>) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        paddingHorizontal: 13,
        paddingVertical: 10,
        borderRadius: 9,
        borderWidth: 1,
        borderColor: selected ? t.primary : t.border,
        backgroundColor: t.grouped,
        opacity: pressed ? 0.65 : 1,
      })}
    >
      <Label size={12} style={{ color: selected ? t.primary : t.text }}>
        {children}
      </Label>
    </Pressable>
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
export function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={{
        width: 48,
        minHeight: 44,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          width: 36,
          height: 22,
          borderRadius: 12,
          backgroundColor: value ? t.primary : "#666666",
          padding: 3,
          alignItems: value ? "flex-end" : "flex-start",
        }}
      >
        <View
          style={{
            width: 16,
            height: 16,
            borderRadius: 8,
            backgroundColor: "#ffffff",
          }}
        />
      </View>
    </Pressable>
  );
}
export function Artwork({
  kind,
  large = false,
}: {
  kind: Track["artwork"];
  large?: boolean;
}) {
  const palette =
    kind === "country"
      ? { bg: "#d4c9ac", ink: "#30362e", line: "#85866d" }
      : kind === "blue"
        ? { bg: "#485a71", ink: "#e4ecf5", line: "#8da0b7" }
        : { bg: "#53615d", ink: "#f0eadb", line: "#a3b0a9" };
  return (
    <View
      accessibilityLabel={large ? "Fictional demo album artwork" : undefined}
      style={{
        width: large ? "100%" : 44,
        height: large ? 210 : 44,
        maxWidth: large ? 300 : 44,
        borderRadius: large ? 7 : 6,
        backgroundColor: palette.bg,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {large ? (
        <>
          <View
            style={{
              position: "absolute",
              width: 270,
              height: 270,
              borderWidth: 1,
              borderColor: palette.line,
              borderRadius: 140,
              left: "35%",
              top: 65,
            }}
          />
          <View
            style={{
              position: "absolute",
              width: 230,
              height: 230,
              borderWidth: 1,
              borderColor: palette.line,
              borderRadius: 120,
              left: "45%",
              top: 35,
            }}
          />
          <Text
            style={{
              color: palette.ink,
              fontFamily: fonts.medium,
              fontSize: 10,
              letterSpacing: 3,
              marginBottom: 13,
            }}
          >
            {kind === "country"
              ? "NORTHBOUND"
              : kind === "blue"
                ? "THE LANTERNS"
                : "JUNE & THE PINES"}
          </Text>
          <Text
            style={{
              fontFamily: "Georgia",
              color: palette.ink,
              fontSize: 43,
              textAlign: "center",
              lineHeight: 44,
              letterSpacing: -1,
            }}
          >
            {kind === "country"
              ? "Open\ncountry"
              : kind === "blue"
                ? "Blue\nhour"
                : "Slow\nmornings"}
          </Text>
          <Text
            style={{
              color: palette.ink,
              fontFamily: fonts.regular,
              fontSize: 9,
              letterSpacing: 2,
              marginTop: 16,
            }}
          >
            DEMO ALBUM
          </Text>
        </>
      ) : (
        <IconMusic size={19} color={palette.ink} />
      )}
    </View>
  );
}
export function Shield({ size = 18 }: { size?: number }) {
  return (
    <IconShieldCheck size={size} color={useTheme().primary} strokeWidth={1.7} />
  );
}
