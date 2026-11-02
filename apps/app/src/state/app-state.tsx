import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PlaybackEvent, Profile, Rule } from "@audio-angel/contracts";
import { buildPlan } from "@audio-angel/filters";
import {
  defaultProfiles,
  demoCapabilities,
  demoLyrics,
  time,
} from "../data/demo";
import { DemoPlayer } from "../services/demo-player";
import { profileRepository } from "../services/profile-repository";
function useAppController() {
  const [player] = useState(() => new DemoPlayer());
  const [playback, setPlayback] = useState(player.getState());
  const [profiles, setProfiles] = useState<readonly Profile[]>(defaultProfiles);
  const [activeId, setActiveId] = useState("kids");
  const [device, setDevice] = useState("iPhone");
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState("");
  const [events, setEvents] = useState<PlaybackEvent[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const saveQueue = useRef(Promise.resolve());
  const active = profiles.find((p) => p.id === activeId) ?? profiles[0];
  const capabilities = demoCapabilities[device];
  const plan = useMemo(
    () =>
      buildPlan(
        active,
        demoLyrics(playback.track.id).spans,
        capabilities,
        playback.track.durationMs,
      ),
    [active, playback.track, capabilities],
  );
  useEffect(() => player.subscribe(setPlayback), [player]);
  useEffect(() => {
    let cancelled = false;
    profileRepository
      .load()
      .then((store) => {
        if (cancelled || !store) return;
        if (
          !store.profiles.length ||
          !store.profiles.some((p) => p.id === store.activeId)
        )
          throw new Error("Invalid profiles");
        setProfiles(store.profiles);
        setActiveId(store.activeId);
      })
      .catch(() => {
        if (!cancelled)
          setNotice(
            "Saved profiles could not be loaded. Default profiles are available.",
          );
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    AsyncStorage.getItem("audio-angel:theme")
      .then((value) => {
        if (!cancelled && (value === "light" || value === "dark"))
          setTheme(value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!loaded) return;
    saveQueue.current = saveQueue.current
      .then(() => profileRepository.save({ profiles, activeId }))
      .catch(() =>
        setNotice(
          "Could not save profiles on this device. Changes remain in this session.",
        ),
      );
  }, [profiles, activeId, loaded]);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const handler = () => {
      if (document.visibilityState !== "visible") {
        void player.pause();
        void player.setVolume(1);
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [player]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        void player.pause();
        void player.setVolume(1);
      }
    });
    return () => subscription.remove();
  }, [player]);
  const addEvent = (
    kind: PlaybackEvent["kind"],
    description: string,
    reason: string,
  ) =>
    setEvents((prev) =>
      [
        {
          id: `${Date.now()}-${Math.random()}`,
          at: Date.now(),
          kind,
          description,
          reason,
          simulated: true,
        },
        ...prev,
      ].slice(0, 100),
    );
  const fired = useRef(new Set<string>());
  useEffect(() => {
    fired.current.clear();
    void player.setVolume(1);
  }, [playback.track.id, active, device, player]);
  useEffect(() => {
    if (!playback.playing) return;
    const action = plan.find(
      (a) => playback.positionMs >= a.startMs && playback.positionMs < a.endMs,
    );
    if (!action) {
      void player.setVolume(1);
      return;
    }
    const key = `${playback.track.id}:${action.startMs}:${action.action}`;
    if (fired.current.has(key)) return;
    fired.current.add(key);
    const reason = action.reasons.join(", ");
    // Record completion after the adapter operation resolves, not during rendering.
    const execute = async () => {
      if (action.action === "skip-section") {
        await player.seek(action.endMs);
        addEvent(
          "seek",
          `Jump simulated · ${time(action.startMs)} → ${time(action.endMs)}`,
          reason,
        );
      } else if (action.action === "skip-song") {
        await player.next();
        addEvent("skip", "Song skip simulated", reason);
      } else {
        await player.setVolume(0);
        addEvent(
          "mute",
          `Mute simulated · ${time(action.startMs)}–${time(action.endMs)}`,
          reason,
        );
      }
    };
    void execute();
  }, [playback.positionMs, playback.playing, playback.track.id, plan, player]);
  function selectProfile(id: string) {
    const profile = profiles.find((p) => p.id === id);
    if (!profile) return;
    setActiveId(id);
    addEvent("profile", "Profile changed", profile.name);
  }
  function updateRule(id: string, update: Partial<Rule>) {
    setProfiles((prev) =>
      prev.map((p) =>
        p.id === activeId
          ? {
              ...p,
              rules: p.rules.map((r) =>
                r.id === id ? { ...r, ...update } : r,
              ),
            }
          : p,
      ),
    );
  }
  function addRule(
    label: string,
    kind: "term" | "topic",
    action: Rule["action"],
  ) {
    const value = label.trim();
    if (!value) return;
    setProfiles((prev) =>
      prev.map((p) =>
        p.id === activeId
          ? {
              ...p,
              rules: [
                ...p.rules,
                {
                  id: `custom-${Date.now()}`,
                  label: value,
                  value,
                  kind,
                  action,
                  enabled: true,
                },
              ],
            }
          : p,
      ),
    );
  }
  function createProfile(name: string) {
    if (!name.trim()) return;
    const id = `profile-${Date.now()}`;
    setProfiles((prev) => [...prev, { id, name: name.trim(), rules: [] }]);
    setActiveId(id);
  }
  function renameProfile(name: string) {
    if (name.trim())
      setProfiles((prev) =>
        prev.map((p) => (p.id === activeId ? { ...p, name: name.trim() } : p)),
      );
  }
  function changeTheme(value: "dark" | "light") {
    setTheme(value);
    void AsyncStorage.setItem("audio-angel:theme", value).catch(() =>
      setNotice("Theme could not be saved."),
    );
  }
  function seek(ms: number) {
    fired.current.clear();
    void player.setVolume(1);
    void player.seek(ms);
  }
  return {
    player,
    playback,
    profiles,
    active,
    selectProfile,
    updateRule,
    addRule,
    createProfile,
    renameProfile,
    device,
    setDevice,
    capabilities,
    plan,
    theme,
    changeTheme,
    notice,
    setNotice,
    loaded,
    events,
    clearEvents: () => setEvents([]),
    saved,
    toggleSaved: () =>
      setSaved((prev) =>
        prev.includes(playback.track.id)
          ? prev.filter((id) => id !== playback.track.id)
          : [...prev, playback.track.id],
      ),
    seek,
  };
}
type Controller = ReturnType<typeof useAppController>;
const Context = createContext<Controller | null>(null);
export function AppProvider({ children }: React.PropsWithChildren) {
  const value = useAppController();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useApp() {
  const value = useContext(Context);
  if (!value) throw new Error("AppProvider is required");
  return value;
}
