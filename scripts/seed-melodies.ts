#!/usr/bin/env tsx
/**
 * Seed initial melodies into Supabase.
 * Usage: npx tsx scripts/seed-melodies.ts
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join } from "path";
import "dotenv/config";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const melodies = [
  {
    title: "Twinkle Twinkle Little Star",
    file: "public/sample-melodies/twinkle.xml",
    tempo: 100,
    beats_per_measure: 4,
    beat_unit: 4,
    default_key: "C",
  },
  {
    title: "Ode to Joy",
    file: "public/sample-melodies/ode-to-joy.xml",
    tempo: 108,
    beats_per_measure: 4,
    beat_unit: 4,
    default_key: "C",
  },
];

async function seed() {
  for (const m of melodies) {
    const content = readFileSync(join(process.cwd(), m.file), "utf-8");
    const { error } = await supabase.from("melodies").upsert(
      {
        title: m.title,
        musicxml_content: content,
        tempo: m.tempo,
        beats_per_measure: m.beats_per_measure,
        beat_unit: m.beat_unit,
        default_key: m.default_key,
      },
      { onConflict: "title" }
    );
    if (error) {
      console.error(`Failed to seed "${m.title}":`, error.message);
    } else {
      console.log(`✓ Seeded: ${m.title}`);
    }
  }
}

seed().catch(console.error);
