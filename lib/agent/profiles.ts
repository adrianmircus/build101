import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PROFILES, type ProfileId } from "@/lib/profiles";

// Each profile's data lives in data/profiles/<id>.md and is loaded by the team, with sources.
// Read on every request: editing the .md shows up in the next generation, no restart needed.
export type ProfileData = {
  id: ProfileId;
  label: string;
  fullName: string;
  text: string;
  hasData: boolean;
};

const FOLDER = path.join(process.cwd(), "data", "profiles");

export async function loadProfile(id: ProfileId): Promise<ProfileData | null> {
  // Known ids only: the id is never used to build a path without validation.
  const profile = PROFILES.find((p) => p.id === id);
  if (!profile) return null;

  let text = "";
  try {
    text = await readFile(path.join(FOLDER, `${profile.id}.md`), "utf8");
  } catch {
    // No file is the same as no data.
  }

  // The empty template has only headings and comments: that doesn't count as data.
  const linesWithData = text
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.trim().startsWith("#"));

  return { ...profile, text: text.trim(), hasData: linesWithData.length > 0 };
}
