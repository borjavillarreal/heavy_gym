// Orchestration only: read config/state, talk to Hevy, print. The math lives in engine.js.
const fs=require('fs'), path=require('path');
const {ingestWorkout,noteFor,followerNoteFor,leaderOf,planRoutine,fmt}=require('./engine');
const hevy=require('./hevy');
const ROOT=path.join(__dirname,'..');
const CFG=JSON.parse(fs.readFileSync(path.join(ROOT,'config.json'),'utf8'));
const STATE_F=path.join(ROOT,'state.json');
const state=JSON.parse(fs.readFileSync(STATE_F,'utf8'));
const APPLY=process.env.APPLY==='1';
const hasAmrap=cx=>cx.sets.some(s=>String(s[1]).includes('+'));

/* ---------- 1. read saved workouts -> update maxes (in memory) ---------- */
function ingest(workout,routines){
  const rt=routines.find(r=>r.id===workout.routine_id);
  const cfgR=rt&&CFG.routines.find(c=>c.title===rt.title);
  if(!cfgR) return ['  (not a configured routine — ignored)'];
  const out=[];
  for(const r of ingestWorkout(workout,cfgR,CFG)){
    const tags=r.warnings.length?'  ('+r.warnings.join(', ')+')':'';
    if(!r.max){ out.push(`  ! ${r.lift}: week max unchanged${tags}`); continue; }
    const prev=state.maxes[r.lift]?.value; const max=+r.max.toFixed(2);
    state.maxes[r.lift]={value:max,source:`${workout.title} ${workout.start_time?.slice(0,10)}`,single:r.single};
    state.history.push({date:workout.start_time,lift:r.lift,top:r.top,back:r.back,max});
    out.push(`  ${r.lift}: week max ${prev?fmt(+prev.toFixed(1)):'–'} -> ${fmt(+max.toFixed(1))}${tags}`);
  }
  return out;
}

async function main(){
  const cmd=process.argv[2]||'run';
  if(cmd==='preview'){
    for(const r of CFG.routines) for(const cx of r.exercises){
      const max=state.maxes[cx.lift]?.value; if(!max) continue;
      const leader=leaderOf(r,cx);
      const note=hasAmrap(cx)?noteFor(cx,max,CFG):leader?followerNoteFor(cx,leader,leader.lift,max,CFG):null;
      if(note) console.log(`\n=== ${r.title} · ${cx.lift}${leader?' (after the '+leader.lift+' 1+)':''} ===\n`+note);
    }
    return;
  }
  const routines=await hevy.routines();
  if(cmd==='list'){ for(const r of routines){ console.log(`\n"${r.title}"  (id ${r.id})`); for(const e of r.exercises||[]) console.log(`   ${e.exercise_template_id}  ${e.title}  — ${(e.sets||[]).filter(s=>s.type==='normal').length} working sets`); } return; }
  if(cmd!=='run') throw new Error(`unknown command "${cmd}" (list | preview | run)`);

  console.log(APPLY?'APPLY mode: Hevy will be updated':'DRY RUN: nothing is written (set APPLY=1 to write)');
  const fresh=(await hevy.recentWorkouts(10)).filter(w=>!state.processed.includes(w.id)).reverse();   // oldest first
  for(const w of fresh){ console.log(`\nWorkout "${w.title}" ${w.start_time?.slice(0,16)}`); ingest(w,routines).forEach(l=>console.log(l)); }
  if(!fresh.length) console.log('\nNo new workouts.');

  let failed=false;
  for(const cfgR of CFG.routines){
    const meta=routines.find(r=>r.title===cfgR.title); if(!meta){ console.log(`\n! Routine "${cfgR.title}" not found in Hevy`); continue; }
    const rt=await hevy.getRoutine(meta.id); const {body,changes,warnings}=planRoutine(rt,cfgR,state.maxes,CFG);
    if(!changes.length&&!warnings.length) continue;
    console.log(`\nRoutine "${cfgR.title}"`); [...warnings,...changes].forEach(c=>console.log(c));
    if(!changes.length) continue;                       // warnings alone never trigger a PUT
    if(APPLY){ await hevy.putRoutine(meta.id,body);
      const again=planRoutine(await hevy.getRoutine(meta.id),cfgR,state.maxes,CFG).changes;
      if(again.length){ failed=true; console.log('  ! verify: Hevy did not keep every change'); again.forEach(c=>console.log('  '+c)); }
      else console.log('  verified'); }
  }
  if(APPLY){
    if(failed) throw new Error('verification failed — state.json not saved, the next run retries');
    state.processed.push(...fresh.map(w=>w.id)); state.processed=state.processed.slice(-200);
    fs.writeFileSync(STATE_F,JSON.stringify(state,null,2)+'\n');
  }
}
main().catch(e=>{ console.error(e.message); process.exit(1); });
