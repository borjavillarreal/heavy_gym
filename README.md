# hevy-pl-sync

After every saved Hevy workout: reads your 1+ / 3+ set, updates the week max with the same RPE engine as your Excel, rewrites the next sessions' weights in your Hevy routines, and refreshes the note on each AMRAP exercise with the "your reps → remaining sets" table (RPE 10 and RPE 9).

## Setup (≈20 min, once)
1. **Create a private GitHub repo** and upload these files.
2. **API key**: in Hevy go to hevy.com/settings?developer, generate a key. In the repo: Settings › Secrets and variables › Actions › New repository secret, name `HEVY_API_KEY`. Never paste it anywhere else.
3. **Map your routines**: on your computer run `HEVY_API_KEY=... node src/run.js list` (Node 20+). Copy each routine title and exercise_template_id into `config.json` (replace every `PASTE_..._ID`). The number of working (non-warm-up) sets in Hevy must equal the sets in config.
4. **Dry run**: Actions › hevy-sync › Run workflow, apply = `0`. Read the log: every weight change and note is listed, nothing is written.
5. **Go live**: Settings › Secrets and variables › Actions › Variables, add `APPLY` = `1`. From now on it runs every 30 min (5am–11pm CDMX).

## In the gym
- Log RPE on the 1+ set. Without it the script assumes RPE 10 (conservative).
- Find your reps in the note, type those weights into the remaining sets.
- Your own text in the exercise note is kept; only the block between ⟦PL⟧ and ⟦/PL⟧ is replaced.

## Commands
- `node src/run.js preview` – print every note from state.json (no API call)
- `node src/run.js list` – routines and exercise ids
- `node src/run.js run` – dry run; `APPLY=1 node src/run.js run` – write

## Rules (config.json)
TM = ceil(week max × 90%, 5). Sets = mround(TM × %, 5). Week max = e1RM of the 1+ set (`maxRule: "top"`); `"average"` restores the Excel rule. Deload: set APPLY to 0 that week.
