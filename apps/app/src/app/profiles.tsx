import React, { useState } from "react";
import { View, Pressable } from "react-native";
import { IconPlus, IconPencil, IconX } from "../ui/icons";
import type { Action } from "@audio-angel/contracts";
import { useApp } from "../state/app-state";
import { useTheme } from "../ui/theme";
import {
  Button,
  Chip,
  Field,
  Group,
  IconButton,
  Label,
  Notice,
  Row,
  Title,
  Toggle,
} from "../ui/components";
const actions: Action[] = ["mute", "skip-section", "skip-song"];
const actionLabel = (action: Action) =>
  action === "mute"
    ? "Mute word"
    : action === "skip-section"
      ? "Skip section"
      : "Skip song";
export default function Profiles() {
  const app = useApp();
  const t = useTheme();
  const [editor, setEditor] = useState<"profile" | "rename" | "filter" | null>(
    null,
  );
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"term" | "topic">("term");
  const [action, setAction] = useState<Action>("mute");
  const [editingAction, setEditingAction] = useState<string | null>(null);
  function open(value: typeof editor) {
    setName(value === "rename" ? app.active.name : "");
    setEditor(value);
  }
  function save() {
    if (!name.trim()) return;
    if (editor === "profile") app.createProfile(name);
    else if (editor === "rename") app.renameProfile(name);
    else app.addRule(name, kind, action);
    setEditor(null);
    setName("");
  }
  return (
    <View>
      <Row>
        <Title>Your profiles</Title>
        <IconButton
          icon={IconPlus}
          label="Create profile"
          onPress={() => open("profile")}
        />
      </Row>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 24,
        }}
      >
        {app.profiles.map((profile) => (
          <Chip
            key={profile.id}
            selected={app.active.id === profile.id}
            onPress={() => {
              app.selectProfile(profile.id);
              setEditingAction(null);
            }}
          >
            {profile.name}
          </Chip>
        ))}
      </View>
      <Label muted size={12} style={{marginBottom:16}}>The live test uses a limited cuss-word and drug-word list plus custom terms. Mute skips the matching lyric line; skip-song stops playback. Topics and other categories are not checked.</Label>
      <Row>
        <View style={{ flex: 1 }}>
          <Label bold size={17}>
            Filters
          </Label>
          <Label muted size={12}>
            Applies to {app.active.name}
          </Label>
        </View>
        <IconButton
          icon={IconPencil}
          label="Rename current profile"
          onPress={() => open("rename")}
        />
      </Row>
      {editor && (
        <View
          style={{
            borderWidth: 1,
            borderColor: t.border,
            padding: 16,
            borderRadius: 12,
            marginTop: 16,
            gap: 14,
          }}
        >
          <Row>
            <Label bold>
              {editor === "filter"
                ? "Add a filter"
                : editor === "rename"
                  ? "Rename profile"
                  : "New profile"}
            </Label>
            <IconButton
              icon={IconX}
              label="Cancel editing"
              onPress={() => setEditor(null)}
            />
          </Row>
          <Field
            label={editor === "filter" ? "Word or topic" : "Profile name"}
            value={name}
            onChangeText={setName}
            placeholder={
              editor === "filter"
                ? "A word or phrase to filter"
                : "Profile name"
            }
            autoFocus
          />
          {editor === "filter" && (
            <>
              <Row style={{ justifyContent: "flex-start" }}>
                <Chip
                  selected={kind === "term"}
                  onPress={() => setKind("term")}
                >
                  Specific term
                </Chip>
                <Chip
                  selected={kind === "topic"}
                  onPress={() => setKind("topic")}
                >
                  Topic · later
                </Chip>
              </Row>
              <View style={{ flexDirection: "row", gap: 7, flexWrap: "wrap" }}>
                {actions.map((value) => (
                  <Chip
                    key={value}
                    selected={value === action}
                    onPress={() => setAction(value)}
                  >
                    {actionLabel(value)}
                  </Chip>
                ))}
              </View>
              {kind === "topic" && (
                <Label muted size={12}>
                  You can save this topic, but it will not run until a topic
                  provider is connected.
                </Label>
              )}
            </>
          )}
          <Button disabled={!name.trim()} onPress={save}>
            Save {editor === "filter" ? "filter" : "profile"}
          </Button>
        </View>
      )}
      <Group>
        {app.active.rules.map((rule, i) => (
          <View
            key={rule.id}
            style={{
              borderBottomWidth: 1,
              borderBottomColor: t.border,
              paddingVertical: 12,
            }}
          >
            <Row>
              <View style={{ flex: 1 }}>
                <Label>{rule.label}</Label>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Change action for ${rule.label}`}
                  onPress={() =>
                    setEditingAction(editingAction === rule.id ? null : rule.id)
                  }
                  style={{ minHeight: 44, justifyContent: "center" }}
                >
                  <Label size={12} style={{ color: t.primary }}>
                    {actionLabel(rule.action)}
                    {rule.action === "mute" && !app.capabilities.canMute
                      ? " → jump on iPhone"
                      : ""}
                  </Label>
                </Pressable>
                {(rule.kind === "topic" ||
                  (rule.kind === "category" &&
                    !["profanity", "drugs"].includes(rule.value))) && (
                  <Label muted size={11}>
                    Not evaluated yet
                  </Label>
                )}
              </View>
              <Toggle
                label={`Enable ${rule.label}`}
                value={rule.enabled}
                onChange={(enabled) => app.updateRule(rule.id, { enabled })}
              />
            </Row>
            {editingAction === rule.id && (
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: 8,
                  paddingVertical: 8,
                }}
              >
                {actions.map((value) => (
                  <Chip
                    key={value}
                    selected={rule.action === value}
                    onPress={() => {
                      app.updateRule(rule.id, { action: value });
                      setEditingAction(null);
                    }}
                  >
                    {actionLabel(value)}
                  </Chip>
                ))}
              </View>
            )}
          </View>
        ))}
        {!app.active.rules.length && (
          <Label muted style={{ marginTop: 16 }}>
            No filters yet. Add a term to start.
          </Label>
        )}
        <Pressable
          accessibilityRole="button"
          onPress={() => open("filter")}
          style={{ paddingVertical: 18, minHeight: 50 }}
        >
          <Row style={{ justifyContent: "flex-start", gap: 8 }}>
            <IconPlus color={t.primary} size={17} />
            <Label style={{ color: t.primary }}>Add a filter</Label>
          </Row>
        </Pressable>
      </Group>
      <Notice>
        <Label bold size={12}>
          Switch profiles from Now Playing
        </Label>
        <Label muted size={12} style={{ marginTop: 5 }}>
          Profiles stay on this device. The live test evaluates a limited word list;
          topic checks and full category lists connect later.
        </Label>
      </Notice>
    </View>
  );
}
