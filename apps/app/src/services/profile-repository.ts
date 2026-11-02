import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Schema from "effect/Schema";
import { ProfileStore, type ProfileRepository } from "@audio-angel/contracts";
const key = "audio-angel:profiles:v1";
export const profileRepository: ProfileRepository = {
  async load() {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    return Schema.decodeUnknownSync(ProfileStore)(JSON.parse(raw));
  },
  async save(store) {
    await AsyncStorage.setItem(
      key,
      JSON.stringify(Schema.decodeUnknownSync(ProfileStore)(store)),
    );
  },
};
