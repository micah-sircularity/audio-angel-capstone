import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Profile, Rule } from "@audio-angel/contracts";
import { defaultProfiles } from "../data/defaults";
import { profileRepository } from "../services/profile-repository";
function useAppController() {
  const [profiles, setProfiles] = useState<readonly Profile[]>(defaultProfiles);
  const [activeId, setActiveId] = useState("kids");
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState("");
  const saveQueue = useRef(Promise.resolve());
  const active = profiles.find((p) => p.id === activeId) ?? profiles[0];
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
  function selectProfile(id: string) {
    const profile = profiles.find((p) => p.id === id);
    if (!profile) return;
    setActiveId(id);
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
  return {
    profiles,
    active,
    selectProfile,
    updateRule,
    addRule,
    createProfile,
    renameProfile,
    theme,
    changeTheme,
    notice,
    setNotice,
    loaded,
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
