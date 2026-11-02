const { defineConfig } = require("eslint/config");
const expo = require("eslint-config-expo/flat");
module.exports = defineConfig([
  expo,
  { ignores: ["dist/**", ".expo/**", "uniwind-types.d.ts"] },
  // Tabler's published subpaths resolve in Metro; its import-type targets are missing.
  {
    files: ["src/ui/icons.ts"],
    rules: {
      "import/no-unresolved": [
        "error",
        { ignore: ["^@tabler/icons-react-native/Icon"] },
      ],
    },
  },
]);
