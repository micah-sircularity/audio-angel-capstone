# Shared contracts

Effect Schema values are the runtime source of truth. TypeScript types are inferred from each schema with `typeof SchemaName.Type`.

```ts
import * as Schema from "effect/Schema";
import { Profile } from "@audio-angel/contracts";

const profile = Schema.decodeUnknownSync(Profile)(input);
// Throws a ParseError if the input does not satisfy the contract.
```

- `Profile`: non-blank ID/name and an array of rules; empty profiles are valid.
- `Rule`: non-blank ID/label/value, category/term/topic kind, mute/skip-section/skip-song action, boolean enabled flag.
- `TimedLyricLine`: text and a start/end range in non-negative integer milliseconds. End must be strictly after start. Empty text is valid for a silent gap.
- `LyricSpan`: the same range and text plus word/line/estimated timing provenance, preserving the existing player contract.
- `DeviceCapabilities`: boolean mute/seek support and unverified/unsupported/verified background status. `Capabilities` remains an alias. This describes capabilities; it does not perform detection or prove background support.
- `PlannedAction`: a positive-duration range, supported action and at least one non-blank reason.

No string-to-number or string-to-boolean coercion is performed. Invalid enum values, missing fields, blank identifiers, negative/fractional/non-finite timestamps and reversed or zero-length ranges are rejected. Normal Effect Struct behavior applies to extra properties; these schemas do not impose strict unknown-key rejection.

Provider matching, whether a device can execute an action, and track-duration bounds belong in the provider/planner, not these standalone shapes. Duplicate IDs and profile-store references are not validated here.

Run `pnpm test` from the repository root. Contract tests validate representative JSON, the app's current demo fixtures and generated plans, and malformed input for each requested shape.
