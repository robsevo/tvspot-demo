import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { VerifiedSources } from "./types";

const OUTPUT_PATH = "data/verified-sources.json";
const TMP_PATH = OUTPUT_PATH + ".tmp";

export function readExisting(): VerifiedSources | null {
  try {
    if (!existsSync(OUTPUT_PATH)) return null;
    return JSON.parse(readFileSync(OUTPUT_PATH, "utf-8"));
  } catch {
    return null;
  }
}

export function writeAtomic(data: VerifiedSources): void {
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(TMP_PATH, JSON.stringify(data, null, 2), "utf-8");
  renameSync(TMP_PATH, OUTPUT_PATH);
}