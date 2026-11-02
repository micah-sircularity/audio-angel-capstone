// Tabler 3.49 publishes icon subpaths but points their import types at missing files.
// Preserve the upstream icon props while importing individual runtime modules.
declare module "@tabler/icons-react-native/*" {
  import type { ComponentType } from "react";
  import type { IconProps } from "@tabler/icons-react-native";
  const icon: ComponentType<IconProps>;
  export default icon;
}
