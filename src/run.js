const fs=require('fs'), path=require('path');
const {pct,e1rm,mround,ceilTo}=require('./engine');
const hevy=require('./hevy');
const ROOT=path.join(__dirname,'..');
const CFG=JSON.parse(fs.readFileSync(path.join(ROOT,'config.json'),'utf8'));
const STATE_F=path.join(ROOT,'state.json');
const state=JSON.parse(fs.readFileSync(STATE_F,'utf8'));
const APPLY=process.env.APPLY==='1';
const LB=0.45359237;
const toUser=kg=>CFG.unit==='lb'?Math.round(kg/LB*2)/2:Math.round(kg*4)/4;
const toKg=w=>CFG.unit==='lb'?+(w*LB).toFixed(3):w;
const isAmrap=r=>String(r).includes('+');
const tmOf=lift=>{ const m=state.maxes[lift]?.value; return m?ceilTo(m*CFG.tmPct,CFG.step):null; };
const fmt=n=>Number.isInteger(n)?String(n):n.toFixed(1);
const MARK_A='⟦PL⟧', MARK_B='⟦/PL⟧';

/* ---------- 1. read saved workouts -> update maxes ---------- */
function ingest(workout, routines){
  const rt=routines.find(r=>r.id===workout.routine_id);
  const cfgR=rt&&CFG.routines.find(c=>c.title===rt.title);
  if(!cfgR) return [];
  const out=[];
  for(const cx of cfgR.exercises){
    const ai=cx.sets.findIndex(s=>isAmrap(s[1])); if(ai<0) continue;
    const ex=workout.exercises.find(e=>e.exercise_template_id===cx.templateId); if(!ex) continue;
    const normal=ex.sets.filter(s=>s.type==='normal');
    const top=normal[ai], back=[...normal].reverse().find(s=>s!==top&&s.rpe);
    const a=top&&top.rpe?e1rm(toUser(top.weight_kg),top.reps,top.rpe):(top?e1rm(toUser(top.weight_kg),top.reps,10):null);
    const b=back?e1rm(toUser(back.weight_kg),back.reps,back.rpe):null;
    const max=CFG.maxRule==='average'&&a&&b?(a+b)/2:(a||b);
    if(!max){ out.push(`  ! ${cx.lift}: no usable set (need reps 1–20 and RPE 6.5–10)`); continue; }
    const prev=state.maxes[cx.lift]?.value;
    state.maxes[cx.lift]={value:+max.toFixed(2),source:`${workout.title} ${workout.start_time?.slice(0,10)}`,single:!(a&&b)};
    state.history.push({date:workout.start_time,lift:cx.lift,top:top&&{w:toUser(top.weight_kg),r:top.reps,rpe:top.rpe??null},back:back&&{w:toUser(back.weight_kg),r:back.reps,rpe:back.rpe},max:+max.toFixed(2)});
    const tags=[]; if(!a) tags.push('from back-off only'); if(CFG.maxRule==='average'&&a&&!b) tags.push('single-set estimate'); if(top&&!top.rpe) tags.push('1+ RPE missing: assumed 10');
    out.push(`  ${cx.lift}: week max ${prev?fmt(+prev.toFixed(1)):'–'} -> ${fmt(+max.toFixed(1))}${tags.length?'  ('+tags.join(', ')+')':''}`);
  }
  return out;
}

/* ---------- 2. build the pinned note for an AMRAP exercise ---------- */
function noteFor(cx){
  const tm=tmOf(cx.lift); const ai=cx.sets.findIndex(s=>isAmrap(s[1]));
  const W=mround(tm*cx.sets[ai][0],CFG.step); const after=cx.sets.slice(ai+1);
  const lines=[`${MARK_A}`,`${cx.sets[ai][1]} @ ${fmt(W)} ${CFG.unit} — find your row, load the sets after it`,`(${after.map(s=>Math.round(s[0]*100)+'%×'+s[1]).join(', ')} of today's TM)`];
  for(const rpe of CFG.noteRpe){
    lines.push('',`RPE ${rpe}`);
    for(const r of CFG.noteReps){
      const e=e1rm(W,r,rpe); if(!e) continue; const t=ceilTo(e*CFG.tmPct,CFG.step);
      lines.push(`${String(r).padStart(2)} → ${after.map(s=>fmt(mround(t*s[0],CFG.step))).join(' · ')}`);
    }
  }
  lines.push('',`TM ${fmt(tm)} from week max ${fmt(+state.maxes[cx.lift].value.toFixed(1))}`,MARK_B);
  return lines.join('\n');
}
function mergeNote(old,block){
  old=old||''; const i=old.indexOf(MARK_A), j=old.indexOf(MARK_B);
  if(i>=0&&j>i) return (old.slice(0,i)+block+old.slice(j+MARK_B.length)).trim();
  return (old?old.trim()+'\n\n':'')+block;
}

/* ---------- 3. rewrite routines with next weights + note ---------- */
const clean=o=>Object.fromEntries(Object.entries(o).filter(([,v])=>v!==null&&v!==undefined));
function planRoutine(rt,cfgR){
  const changes=[]; const used={};
  const exercises=rt.exercises.map(ex=>{
    const n=used[ex.exercise_template_id]=(used[ex.exercise_template_id]||0)+1;
    const cx=cfgR.exercises.filter(c=>c.templateId===ex.exercise_template_id)[n-1];
    let sets=ex.sets.map(s=>clean({type:s.type,weight_kg:s.weight_kg,reps:s.reps,distance_meters:s.distance_meters,duration_seconds:s.duration_seconds,custom_metric:s.custom_metric,rep_range:s.rep_range}));
    let notes=ex.notes||null;
    if(cx&&tmOf(cx.lift)){
      const tm=tmOf(cx.lift); let k=0;
      sets=sets.map(s=>{ if(s.type!=='normal') return s; const p=cx.sets[k++]; if(!p) return s;
        const w=mround(tm*p[0],CFG.step); const reps=isAmrap(p[1])?parseInt(p[1]):p[1];
        if(Math.abs(toUser(s.weight_kg||0)-w)>0.4) changes.push(`  ${ex.title||cx.lift} set ${k}: ${s.weight_kg!=null?fmt(toUser(s.weight_kg)):'–'} -> ${fmt(w)} ${CFG.unit}`);
        const {rep_range,...rest}=s; return {...rest,weight_kg:toKg(w),reps}; });
      if(k!==cx.sets.length) changes.push(`  ! ${ex.title||cx.lift}: Hevy has ${k} working sets, config has ${cx.sets.length} — only ${Math.min(k,cx.sets.length)} filled`);
      if(cx.sets.some(s=>isAmrap(s[1]))){ const nn=mergeNote(notes,noteFor(cx)); if(nn!==notes){ notes=nn; changes.push(`  ${ex.title||cx.lift}: note updated`);} }
    }
    return clean({exercise_template_id:ex.exercise_template_id,superset_id:ex.superset_id,rest_seconds:ex.rest_seconds,notes,sets});
  });
  return {body:clean({title:rt.title,notes:rt.notes,exercises}),changes};
}

async function main(){
  const cmd=process.argv[2]||'run';
  if(cmd==='preview'){ for(const r of CFG.routines) for(const cx of r.exercises) if(cx.sets.some(s=>isAmrap(s[1]))&&tmOf(cx.lift)) console.log(`\n=== ${r.title} · ${cx.lift} ===\n`+noteFor(cx)); return; }
  const routines=await hevy.routines();
  if(cmd==='list'){ for(const r of routines){ console.log(`\n"${r.title}"  (id ${r.id})`); for(const e of r.exercises) console.log(`   ${e.exercise_template_id}  ${e.title}  — ${e.sets.filter(s=>s.type==='normal').length} working sets`); } return; }

  console.log(APPLY?'APPLY mode: Hevy will be updated':'DRY RUN: nothing is written (set APPLY=1 to write)');
  const fresh=(await hevy.recentWorkouts(10)).filter(w=>!state.processed.includes(w.id)).reverse();
  for(const w of fresh){ console.log(`\nWorkout "${w.title}" ${w.start_time?.slice(0,16)}`); ingest(w,routines).forEach(l=>console.log(l)); }
  if(!fresh.length) console.log('\nNo new workouts.');

  for(const cfgR of CFG.routines){
    const meta=routines.find(r=>r.title===cfgR.title); if(!meta){ console.log(`\n! Routine "${cfgR.title}" not found in Hevy`); continue; }
    const rt=await hevy.getRoutine(meta.id); const {body,changes}=planRoutine(rt,cfgR);
    if(!changes.length) continue;
    console.log(`\nRoutine "${cfgR.title}"`); changes.forEach(c=>console.log(c));
    if(APPLY){ await hevy.putRoutine(meta.id,body);
      const back=await hevy.getRoutine(meta.id); const again=planRoutine(back,cfgR).changes.filter(c=>!c.includes('!'));
      console.log(again.length?'  ! verify: Hevy did not keep every change':'  verified'); }
  }
  if(APPLY){ state.processed.push(...fresh.map(w=>w.id)); state.processed=state.processed.slice(-200); fs.writeFileSync(STATE_F,JSON.stringify(state,null,2)+'\n'); }
}
main().catch(e=>{ console.error(e.message); process.exit(1); });
