import type { StreamingPlatformKey } from "@/lib/types";

export type PlatformMeta = {
  key: StreamingPlatformKey;
  label: string;
  shortLabel: string;
  color: string;
  logoUrl: string;
  aliases: string[];
};

export const PLATFORM_ORDER: StreamingPlatformKey[] = [
  "netflix",
  "hulu",
  "max",
  "disney",
  "prime",
  "apple",
  "peacock",
  "paramount"
];

export const PLATFORM_META: Record<StreamingPlatformKey, PlatformMeta> = {
  netflix: {
    key: "netflix",
    label: "Netflix",
    shortLabel: "Netflix",
    color: "#E50914",
    logoUrl: "https://cdn.simpleicons.org/netflix/E50914",
    aliases: ["netflix"]
  },
  hulu: {
    key: "hulu",
    label: "Hulu",
    shortLabel: "Hulu",
    color: "#1CE783",
    logoUrl: "https://cdn.simpleicons.org/hulu/1CE783",
    aliases: ["hulu"]
  },
  max: {
    key: "max",
    label: "HBO Max",
    shortLabel: "Max",
    color: "#8B5CF6",
    logoUrl: "https://cdn.simpleicons.org/hbo/8B5CF6",
    aliases: ["max", "hbo", "hbo max", "hbomax"]
  },
  disney: {
    key: "disney",
    label: "Disney+",
    shortLabel: "Disney+",
    color: "#113CCF",
    logoUrl: "https://cdn.simpleicons.org/disney+/113CCF",
    aliases: ["disney", "disney+", "disney plus"]
  },
  prime: {
    key: "prime",
    label: "Amazon Prime",
    shortLabel: "Prime",
    color: "#00A8E1",
    logoUrl: "https://cdn.simpleicons.org/amazonprime/00A8E1",
    aliases: ["prime", "prime video", "amazon prime", "amazon prime video", "amazonvideo"]
  },
  apple: {
    key: "apple",
    label: "Apple TV+",
    shortLabel: "Apple TV+",
    color: "#A3AAAE",
    logoUrl: "https://cdn.simpleicons.org/appletv/A3AAAE",
    aliases: ["apple", "apple tv", "apple tv+", "appletv+"]
  },
  peacock: {
    key: "peacock",
    label: "Peacock",
    shortLabel: "Peacock",
    color: "#00B3FF",
    logoUrl: "https://cdn.simpleicons.org/peacock/00B3FF",
    aliases: ["peacock"]
  },
  paramount: {
    key: "paramount",
    label: "Paramount+",
    shortLabel: "Paramount+",
    color: "#0064FF",
    logoUrl: "https://cdn.simpleicons.org/paramount+/0064FF",
    aliases: ["paramount", "paramount+", "paramount plus"]
  }
};

export function normalizeProviderToPlatformKey(providerName: string): StreamingPlatformKey | null {
  const normalized = providerName.trim().toLowerCase();
  for (const key of PLATFORM_ORDER) {
    if (PLATFORM_META[key].aliases.some((alias) => normalized.includes(alias))) {
      return key;
    }
  }
  return null;
}
