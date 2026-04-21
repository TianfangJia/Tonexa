# Ear Training App – Setup Guide

## Prerequisites
- Node.js 18+
- A Supabase project (free tier is fine)

---

## 1. Install dependencies
```bash
cd ear-training-app
npm install
```

---

## 2. Configure environment variables
```bash
cp .env.example .env.local
```
Then fill in your values in `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ADMIN_PASSWORD=choose-a-password
NEXT_PUBLIC_ADMIN_PASSWORD=same-password
```

---

## 3. Set up Supabase database
In your Supabase project SQL editor, paste the contents of:
```
supabase/migrations/001_initial.sql
```
and execute it. This creates all tables and RLS policies.

---

## 4. Create Supabase Storage bucket
In the Supabase dashboard → Storage → New bucket:
- **Name**: `recordings`
- **Public**: No (private)

---

## 5. Seed sample melodies (optional)
```bash
# Install ts-node/tsx if needed
npm install -g tsx dotenv

# Run seed script
npx tsx scripts/seed-melodies.ts
```

Or upload melodies directly via the admin page after step 7.

---

## 6. Run the development server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000)

---

## 7. Access admin
Navigate to [http://localhost:3000/admin](http://localhost:3000/admin)
Enter the `ADMIN_PASSWORD` you set in step 2.

From the admin dashboard you can:
- Upload MusicXML melodies
- View all student sessions
- Download recording audio
- Export results as CSV

---

## Uploading your own MusicXML files
The admin "Upload Melody" form accepts `.xml` and `.musicxml` files.
Supported features:
- Monophonic melodies (single voice)
- Standard note durations (whole, half, quarter, eighth, sixteenth)
- Common time signatures (4/4, 3/4, 2/4, 6/8)
- Key signatures
- Tempo markings via `<sound tempo="..."/>`

---

## Configuring thresholds
Edit the constants in `types/scoring.ts`:
```ts
export const PITCH_THRESHOLDS = {
  green: 50,   // cents – quarter tone
  yellow: 100, // cents – half tone
  red: 200,    // cents – whole tone
};

export const RHYTHM_THRESHOLDS = {
  green: 50,   // ms
  yellow: 100, // ms
};

export const MEASURE_PASS_THRESHOLD = 0.8; // 80% of notes must pass
```

Edit onset detection sensitivity in `lib/audio/onsetDetection.ts`:
```ts
export const DEFAULT_ONSET_CONFIG: OnsetConfig = {
  energyThreshold: 0.05, // 0–1, lower = more sensitive
  minOnsetGapMs: 80,     // minimum ms between onsets
};
```

---

## Production deployment
1. Push to GitHub
2. Connect repo to Vercel
3. Add all env vars to Vercel project settings
4. Deploy

---

## Known limitations / Future upgrades

| Area | Current MVP | Future |
|---|---|---|
| Pitch detection | ScriptProcessorNode (deprecated) | AudioWorklet for lower latency |
| MusicXML transposition | Regex-based XML patching | Proper XSLT / music21 server transform |
| Onset detection | RMS energy threshold | Spectral flux for better accuracy |
| Admin auth | Client-side password | Supabase Auth with proper sessions |
| Student assignment | Any student can access any melody | Per-student melody assignment |
| Polyphony | Monophonic only | Chord/harmony support |
| MXL support | Plain XML only | Compressed .mxl decompression |
