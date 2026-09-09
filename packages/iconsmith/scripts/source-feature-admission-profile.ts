/** Fixed, exact-source local-feature profiles used by normal source admission. */
import { styleHash } from "../src/pipeline/style.js";
import type { Finish, Provenance } from "../src/types.js";
import type { SourceBoundFeatureRegion } from "./family-parts.js";

export type SourceFeatureRepresentation = "assembly" | "indexed";
export interface SourceFeatureProfileObservation {
  nativeSize: 16 | 24;
  rasterization: { kind: "native-master" | "resampled-source" };
  regions: readonly SourceBoundFeatureRegion[];
}
interface SourceFeatureAdmissionProfileEntry {
  finish: Finish;
  observations: readonly SourceFeatureProfileObservation[];
  representation: SourceFeatureRepresentation;
  sourceName: string;
  sourceOrigin: Provenance["origin"];
  sourceSet: string;
  sourceSha256: string;
  targetMaster: string;
  targetMasterNativeSize: 16 | 20 | 24;
}
export interface SourceFeatureAdmissionProfileBody {
  entries: readonly SourceFeatureAdmissionProfileEntry[];
  evidence: Readonly<Record<string, string>>;
  version: "source-feature-admission-profile-v1";
}
export interface SourceFeatureAdmissionProfile extends SourceFeatureAdmissionProfileBody {
  profileHash: string;
}
export type SourceFeatureProfileResolution =
  | { status: "not-measured" }
  | {
      profile: SourceFeatureAdmissionProfileEntry;
      profileHash: string;
      profileVersion: SourceFeatureAdmissionProfile["version"];
      status: "profiled";
    }
  | { reason: string; status: "refused" };

const paired = (
  regions: readonly SourceBoundFeatureRegion[]
): readonly SourceFeatureProfileObservation[] => [
  {
    nativeSize: 16,
    rasterization: { kind: "resampled-source" },
    regions,
  },
  { nativeSize: 24, rasterization: { kind: "native-master" }, regions },
];

const HOUSE_SOURCE_IDENTITY = {
  sourceOrigin: "literal",
  sourceSet: "blode-icons",
} as const;

const PROFILE_BODY = {
  entries: [
    {
      finish: "filled",
      observations: paired([
        {
          counterContract: true,
          height: 1.5,
          id: "bell-bottom-counter",
          polarity: "clear",
          semanticRole: "counter",
          width: 4.5,
          x: 9.75,
          y: 18.75,
        },
        {
          height: 6,
          id: "bell-body",
          polarity: "ink",
          semanticRole: "contour",
          width: 4,
          x: 10,
          y: 8,
        },
      ]),
      representation: "indexed",
      sourceName: "bell",
      ...HOUSE_SOURCE_IDENTITY,
      sourceSha256:
        "921d4df5c0bad966a30b76c40c29c1909f05c76b978396a4e16165ce28db7e2a",
      targetMaster: "24",
      targetMasterNativeSize: 24,
    },
    {
      finish: "filled",
      observations: paired([
        {
          height: 6,
          id: "keyframe-core",
          polarity: "ink",
          semanticRole: "ink-island",
          width: 6,
          x: 9,
          y: 9,
        },
        {
          height: 4,
          id: "keyframe-upper-right-contour",
          polarity: "ink",
          semanticRole: "contour",
          width: 4,
          x: 14,
          y: 3.5,
        },
      ]),
      representation: "indexed",
      sourceName: "keyframe",
      ...HOUSE_SOURCE_IDENTITY,
      sourceSha256:
        "b3e973d8ed930dd87474e6e508dbfa08326156c8eb023e5c7afabd7d24346285",
      targetMaster: "24",
      targetMasterNativeSize: 24,
    },
    {
      finish: "filled",
      observations: paired([
        {
          height: 3,
          id: "zoom-inner-upper-left-clear",
          polarity: "clear",
          semanticRole: "counter",
          width: 3,
          x: 7,
          y: 7,
        },
        {
          height: 2,
          id: "zoom-plus-center",
          polarity: "ink",
          semanticRole: "modifier",
          width: 2,
          x: 10,
          y: 10,
        },
      ]),
      representation: "indexed",
      sourceName: "zoom-in",
      ...HOUSE_SOURCE_IDENTITY,
      sourceSha256:
        "42fd57b25afe8cead16496561de1cb23d1aef99d7f088b7d0bf462f2ed89c256",
      targetMaster: "24",
      targetMasterNativeSize: 24,
    },
    {
      finish: "filled",
      observations: paired([
        {
          counterContract: true,
          height: 5,
          id: "bike-left-wheel-counter",
          polarity: "clear",
          semanticRole: "counter",
          width: 5,
          x: 2.5,
          y: 12.5,
        },
        {
          counterContract: true,
          height: 5,
          id: "bike-right-wheel-counter",
          polarity: "clear",
          semanticRole: "counter",
          width: 5,
          x: 16.5,
          y: 12.5,
        },
      ]),
      representation: "indexed",
      sourceName: "bike",
      ...HOUSE_SOURCE_IDENTITY,
      sourceSha256:
        "bbeea0ac181e3d3435bd7e281304bf087baf85aec1ac36809409236d8f2d8f23",
      targetMaster: "24",
      targetMasterNativeSize: 24,
    },
    {
      finish: "outlined",
      observations: paired([
        {
          height: 7,
          id: "branch-vertical-connector",
          polarity: "ink",
          semanticRole: "connector",
          width: 2,
          x: 5,
          y: 8,
        },
        {
          height: 5,
          id: "branch-curved-junction",
          polarity: "ink",
          semanticRole: "junction",
          width: 5,
          x: 6,
          y: 10,
        },
      ]),
      representation: "indexed",
      sourceName: "branch-simple",
      ...HOUSE_SOURCE_IDENTITY,
      sourceSha256:
        "e4a30da86b6b078cfb6508c49e2c739d6362bfbad23c48cc13850533e34fd262",
      targetMaster: "24",
      targetMasterNativeSize: 24,
    },
    {
      finish: "outlined",
      observations: paired([
        {
          height: 3.5,
          id: "strawberry-center-seed",
          polarity: "ink",
          semanticRole: "rhythm",
          width: 2,
          x: 11,
          y: 9.25,
        },
        {
          height: 2,
          id: "strawberry-lower-contour",
          polarity: "ink",
          semanticRole: "contour",
          width: 6,
          x: 9,
          y: 19,
        },
      ]),
      representation: "assembly",
      sourceName: "strawberry",
      ...HOUSE_SOURCE_IDENTITY,
      sourceSha256:
        "20e7eb1c26400dc8dd1ac1ac4ae5fde8966399c7aeddcfa40a71d3f5166a2580",
      targetMaster: "24",
      targetMasterNativeSize: 24,
    },
    {
      finish: "filled",
      observations: paired([
        {
          counterContract: true,
          height: 3,
          id: "palette-top-counter",
          polarity: "clear",
          semanticRole: "counter",
          width: 3,
          x: 9,
          y: 6.5,
        },
        {
          counterContract: true,
          height: 3,
          id: "palette-left-counter",
          polarity: "clear",
          semanticRole: "counter",
          width: 3,
          x: 5.75,
          y: 10.75,
        },
        {
          counterContract: true,
          height: 3,
          id: "palette-right-counter",
          polarity: "clear",
          semanticRole: "counter",
          width: 3,
          x: 14,
          y: 8,
        },
      ]),
      representation: "indexed",
      sourceName: "color-palette",
      ...HOUSE_SOURCE_IDENTITY,
      sourceSha256:
        "e40959fc64e2bfe3732df419d3c8a24f0ef1998b7eb91a268ec08a713387a05a",
      targetMaster: "24",
      targetMasterNativeSize: 24,
    },
  ],
  evidence: {
    calibrationInputSha256:
      "07e7765907e3551ca1a3dd3a4d62265e969863d7727ec8b73287d5e79b89957d",
    compiler24RefreshSha256:
      "3e0f9cf4a38e0e5a29919874ea7bab01cf061637ba1d6fffa3662aa49d705ba2",
    waveAgFreezeSha256:
      "5b87d1a6ff2953abf51ed12bc200860ef383022c7bd6cacb3bc49d0c29503b12",
    waveCmPlanSha256:
      "0d41fffbd5007f76f7bfdd1eef7f452becd31b871abe27f6cf7f18bf9a490078",
  },
  version: "source-feature-admission-profile-v1",
} as const satisfies SourceFeatureAdmissionProfileBody;

const selector = (entry: {
  finish: Finish;
  representation: SourceFeatureRepresentation;
  sourceName: string;
  sourceOrigin: Provenance["origin"];
  sourceSet: string;
  targetMaster: string;
}) =>
  [
    entry.sourceName,
    entry.finish,
    entry.sourceOrigin,
    entry.sourceSet,
    entry.targetMaster,
    entry.representation,
  ].join(":");

const VALID_ROLES = new Set([
  "clearance",
  "connector",
  "contour",
  "counter",
  "ink-island",
  "junction",
  "modifier",
  "open-negative-space",
  "rhythm",
]);

const validateRegion = (
  sourceName: string,
  nativeSize: 16 | 24,
  region: SourceBoundFeatureRegion
) => {
  if (
    !region.id ||
    ![region.x, region.y, region.width, region.height].every(Number.isFinite) ||
    region.x < 0 ||
    region.y < 0 ||
    region.width <= 0 ||
    region.height <= 0 ||
    region.x + region.width > 24 ||
    region.y + region.height > 24
  ) {
    throw new Error(
      `${sourceName}: invalid profiled region bounds at ${nativeSize}px`
    );
  }
  if (!VALID_ROLES.has(region.semanticRole)) {
    throw new Error(
      `${sourceName}: invalid profiled semantic role at ${nativeSize}px`
    );
  }
  if (region.counterContract && region.polarity !== "clear") {
    throw new Error(
      `${sourceName}: profiled counter contract must be clear at ${nativeSize}px`
    );
  }
};

const validateEntry = (entry: SourceFeatureAdmissionProfileEntry) => {
  if (!/^[a-f0-9]{64}$/u.test(entry.sourceSha256)) {
    throw new Error(`${entry.sourceName}: invalid profiled source hash`);
  }
  if (!/^[a-z][a-z0-9-]*$/u.test(entry.sourceName)) {
    throw new Error("Invalid profiled source name");
  }
  if (
    !["central", "derived", "literal", "original"].includes(
      entry.sourceOrigin
    ) ||
    !entry.sourceSet
  ) {
    throw new Error(`${entry.sourceName}: invalid profiled source identity`);
  }
  if (![16, 20, 24].includes(entry.targetMasterNativeSize)) {
    throw new Error(`${entry.sourceName}: invalid profiled master size`);
  }
  const bySize = new Map(
    entry.observations.map((item) => [item.nativeSize, item])
  );
  if (
    entry.observations.length !== 2 ||
    bySize.size !== 2 ||
    !bySize.has(16) ||
    !bySize.has(24)
  ) {
    throw new Error(
      `${entry.sourceName}: profiled representation requires paired 16/24 observations`
    );
  }
  for (const [nativeSize, observation] of bySize) {
    const expectedKind =
      nativeSize === entry.targetMasterNativeSize
        ? "native-master"
        : "resampled-source";
    if (observation.rasterization.kind !== expectedKind) {
      throw new Error(
        `${entry.sourceName}: profiled rasterization identity mismatch at ${nativeSize}px`
      );
    }
    if (!observation.regions.length) {
      throw new Error(
        `${entry.sourceName}: profiled region declaration is empty at ${nativeSize}px`
      );
    }
    const ids = observation.regions.map(({ id }) => id);
    if (new Set(ids).size !== ids.length) {
      throw new Error(
        `${entry.sourceName}: duplicate profiled region id at ${nativeSize}px`
      );
    }
    for (const region of observation.regions) {
      validateRegion(entry.sourceName, nativeSize, region);
    }
  }
  if (
    styleHash(bySize.get(16)?.regions) !== styleHash(bySize.get(24)?.regions)
  ) {
    throw new Error(
      `${entry.sourceName}: paired profiled region declarations differ`
    );
  }
};

export const validateSourceFeatureAdmissionProfile = (
  value: SourceFeatureAdmissionProfile
): SourceFeatureAdmissionProfile => {
  const { profileHash, ...body } = value;
  if (styleHash(body) !== profileHash) {
    throw new Error("Source-feature admission profile hash mismatch");
  }
  const selectors = new Set<string>();
  for (const entry of body.entries) {
    const key = selector(entry);
    if (selectors.has(key)) {
      throw new Error(`${entry.sourceName}: duplicate profiled representation`);
    }
    selectors.add(key);
    validateEntry(entry);
  }
  return value;
};

const deepFreeze = <Value>(value: Value): Value => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
};

export const SOURCE_FEATURE_ADMISSION_PROFILE = deepFreeze(
  validateSourceFeatureAdmissionProfile({
    ...PROFILE_BODY,
    profileHash: styleHash(PROFILE_BODY),
  })
);

export const resolveSourceFeatureAdmissionProfile = (input: {
  finish: Finish;
  master: string;
  representation: SourceFeatureRepresentation;
  sourceName: string;
  sourceOrigin: Provenance["origin"];
  sourceSha256: string;
  sourceSet?: string;
}): SourceFeatureProfileResolution => {
  const masterEntries = SOURCE_FEATURE_ADMISSION_PROFILE.entries.filter(
    (entry) =>
      entry.sourceName === input.sourceName &&
      entry.finish === input.finish &&
      entry.sourceOrigin === input.sourceOrigin &&
      entry.sourceSet === input.sourceSet &&
      entry.targetMaster === input.master
  );
  if (!masterEntries.length) {
    return { status: "not-measured" };
  }
  if (
    masterEntries.some((entry) => entry.sourceSha256 !== input.sourceSha256)
  ) {
    return {
      reason: `${input.sourceName}: profiled source hash mismatch`,
      status: "refused",
    };
  }
  const profile = masterEntries.find(
    (entry) => entry.representation === input.representation
  );
  if (!profile) {
    return {
      reason: `${input.sourceName}: ${input.representation} representation is not independently profiled`,
      status: "refused",
    };
  }
  return {
    profile,
    profileHash: SOURCE_FEATURE_ADMISSION_PROFILE.profileHash,
    profileVersion: SOURCE_FEATURE_ADMISSION_PROFILE.version,
    status: "profiled",
  };
};
