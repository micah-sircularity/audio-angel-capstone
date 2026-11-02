import { useApp } from "../state/app-state";
// Adapted from T3 Code's generated-uniwind-default-theme-variables.json (MIT).
const dark = {
  screen: "#152321",
  card: "#1b2c29",
  grouped: "#243833",
  text: "#f5f1e8",
  muted: "#b3c1ba",
  border: "#3e514a",
  primary: "#8ccdbb",
  button: "#f5f1e8",
  buttonText: "#152321",
  danger: "#ff9ca4",
};
const light: typeof dark = {
  screen: "#f6f3ec",
  card: "#fffdf8",
  grouped: "#ebe9df",
  text: "#203832",
  muted: "#596a62",
  border: "#d7ddd2",
  primary: "#256b5b",
  button: "#203832",
  buttonText: "#f6f3ec",
  danger: "#b91c1c",
};
export const fonts = {
  regular: "DMSans_400Regular",
  medium: "DMSans_500Medium",
  bold: "DMSans_700Bold",
};
export function useTheme() {
  return useApp().theme === "dark" ? dark : light;
}
