// Pure logic: RPE table, rounding, week max, TM, notes and routine planning.
// No I/O here, so everything in this file is covered by `node --test`.

/* ---------- §4.1 RPE table ---------- */
const SEQ_A=[1,.955,.922,.892,.863,.837,.811,.786,.762,.739,.707,.68,.653,.626,.599,.572,.545,.518,.491,.464,.437,.41,.383,.356,.329,.302];
const SEQ_B=[.978,.939,.907,.878,.85,.824,.799,.774,.751,.723,.694,.667,.64,.613,.586,.5585,.5315,.5045,.4775,.4505,.4235,.3965,.3695,.3425,.3155,.2885];
const RPES=[10,9.5,9,8.5,8,7.5,7,6.5];
function pct(rpe,reps){
  if(rpe===null||rpe===undefined||reps===null||reps===undefined) return null;
  rpe=+rpe; reps=+reps;
  if(!Number.isInteger(reps)||reps<1||reps>20||!RPES.includes(rpe)) return null;   // 4.5 reps is not 5 reps
  const whole=Number.isInteger(rpe);
  return (whole?SEQ_A:SEQ_B)[reps-1+(whole?10-rpe:9.5-rpe)] ?? null;
}
const e1rm=(w,r,rpe)=>{ const p=pct(rpe,r); return w>0&&p?w/p:null; };

/* ---------- §4.2 rounding ---------- */
const mround=(x,m)=>Math.round(x/m+1e-9)*m;          // Excel MROUND (halves round up)
const ceilTo=(x,m)=>Math.ceil(x/m-1e-9)*m;            // Excel CEILING

/* ---------- §3 units: the API is always kg ---------- */
const LB=0.45359237;
const toKg=(w,unit)=>unit==='lb'?+(w*LB).toFixed(3):w;
const toUser=(kg,unit)=>unit==='lb'?Math.round(kg/LB*2)/2:Math.round(kg*4)/4;

/* ---------- §4.3 week max and TM ---------- */
const isAmrap=r=>String(r).includes('+');
const amrapIndex=cx=>cx.sets.findIndex(s=>isAmrap(s[1]));
const trainingMax=(max,cfg)=>max?ceilTo(max*cfg.tmPct,cfg.step):null;
const setWeight=(tm,p,cfg)=>mround(tm*p,cfg.step);
const fmt=n=>Number.isInteger(n)?String(n):n.toFixed(1);
const fmtPct=p=>+(p*100).toFixed(2)+'%';
const setStr=s=>s?`${fmt(s.w)}×${s.r}${s.rpe!=null?' @'+s.rpe:''}`:'–';

// top/back: { w, r, rpe } in user units (rpe may be null). Returns { max, warnings, single }.
function weekMax(top,back,rule='top'){
  const warnings=[];
  let a=null;
  if(top&&top.r){
    const rpe=top.rpe??10;
    if(top.rpe==null) warnings.push('1+ RPE missing: assumed 10');
    a=e1rm(top.w,top.r,rpe);
    if(!a) warnings.push(`1+ ${setStr(top)} is outside the RPE table (reps 1–20, RPE 6.5–10)`);
  }
  const b=back?e1rm(back.w,back.r,back.rpe):null;
  if(back&&!b) warnings.push(`back-off ${setStr(back)} is outside the RPE table`);
  let max;
  if(rule==='average') max=a&&b?(a+b)/2:(a||b);
  else max=a||b;
  if(max&&!a) warnings.push('from back-off only');
  if(rule==='average'&&a&&!b) warnings.push('single-set estimate');
  return {max:max||null,warnings,single:!(a&&b)};
}

/* ---------- §6 read one saved workout ---------- */
// Pure: returns one entry per AMRAP lift found; the caller decides what to store.
function ingestWorkout(workout,cfgR,cfg){
  const out=[]; const seen={};
  for(const cx of cfgR.exercises){
    const n=seen[cx.templateId]=(seen[cx.templateId]||0)+1;     // same exercise twice -> match in order
    const ai=amrapIndex(cx); if(ai<0||cx.updatesMax===false) continue;
    const ex=(workout.exercises||[]).filter(e=>e.exercise_template_id===cx.templateId)[n-1];
    if(!ex){ out.push({lift:cx.lift,max:null,warnings:['exercise not in this workout']}); continue; }
    const normal=(ex.sets||[]).filter(s=>s.type==='normal');
    const toSet=s=>s&&{w:toUser(s.weight_kg||0,cfg.unit),r:s.reps,rpe:s.rpe??null};
    const topRaw=normal[ai];
    const backRaw=[...normal].reverse().find(s=>s!==topRaw&&s.rpe!=null);
    const top=toSet(topRaw), back=toSet(backRaw);
    const res=weekMax(top,back,cfg.maxRule);
    if(!topRaw) res.warnings.unshift(`no working set #${ai+1} (the 1+)`);
    out.push({lift:cx.lift,top:top||null,back:back||null,...res});
  }
  return out;
}

/* ---------- §4.4 / §7 the pinned note ---------- */
const MARK_A='⟦PL⟧', MARK_B='⟦/PL⟧';
// Equal weights in a row collapse: 110 · 110 · 110 -> "110 (3 sets)". Keeps Saturday and the T2s short on a phone.
function rowText(ws){
  const out=[];
  for(let i=0;i<ws.length;){ let j=i; while(j<ws.length&&ws[j]===ws[i]) j++;
    out.push(fmt(ws[i])+(j-i>1?` (${j-i} sets)`:'')); i=j; }
  return out.join(' · ');
}
// One block per RPE: for each possible 1+ result r, the weights of `sets` from that day's TM.
// Rows: the exercise's own noteReps if it has them, else the config's; never below the AMRAP's minimum (3+ -> 3).
function rowsFor(W,sets,cfg,amrapCx){
  const ai=amrapIndex(amrapCx); const minReps=parseInt(amrapCx.sets[ai][1])||1;
  const reps=(amrapCx.noteReps||cfg.noteReps).filter(r=>r>=minReps);
  const lines=[];
  for(const rpe of cfg.noteRpe){
    lines.push('',`RPE ${rpe}`);
    for(const r of reps){
      const e=e1rm(W,r,rpe); if(!e) continue; const t=ceilTo(e*cfg.tmPct,cfg.step);
      lines.push(`${String(r).padStart(2)} → ${rowText(sets.map(s=>setWeight(t,s[0],cfg)))}`);
    }
  }
  return lines;
}
const pctList=sets=>{
  const items=sets.map(s=>fmtPct(s[0])+'×'+s[1]), out=[];
  for(let i=0;i<items.length;){ let j=i; while(j<items.length&&items[j]===items[i]) j++;
    out.push(items[i]+(j-i>1?` (${j-i} sets)`:'')); i=j; }
  return out.join(', ');
};
function noteFor(cx,max,cfg){
  const tm=trainingMax(max,cfg); const ai=amrapIndex(cx);
  const W=setWeight(tm,cx.sets[ai][0],cfg); const after=cx.sets.slice(ai+1);
  return [MARK_A,`${cx.sets[ai][1]} @ ${fmt(W)} ${cfg.unit} (set ${ai+1}) — find your row, load the sets after it`,
    `(${pctList(after)} of today's TM)`,...rowsFor(W,after,cfg,cx),
    '',`TM ${fmt(tm)} from week max ${fmt(+max.toFixed(1))}`,MARK_B].join('\n');
}
// A later exercise of the same lift on the same day (Fri close-grip after bench): its weights follow today's 1+.
function followerNoteFor(fx,leader,leaderName,max,cfg){
  const tm=trainingMax(max,cfg); const ai=amrapIndex(leader);
  const W=setWeight(tm,leader.sets[ai][0],cfg);
  return [MARK_A,`Follows today's ${leaderName} ${leader.sets[ai][1]} @ ${fmt(W)} ${cfg.unit} — find that row`,
    `(${pctList(fx.sets)} of today's TM)`,...rowsFor(W,fx.sets,cfg,leader),
    '',`Preset weights assume TM ${fmt(tm)}`,MARK_B].join('\n');
}
// The AMRAP exercise earlier in the same routine with the same lift, if any.
function leaderOf(cfgR,cx){
  if(amrapIndex(cx)>=0) return null;
  const i=cfgR.exercises.indexOf(cx);
  return cfgR.exercises.slice(0,i).find(c=>c.lift===cx.lift&&amrapIndex(c)>=0)||null;
}
function mergeNote(old,block){
  old=old||''; const i=old.indexOf(MARK_A), j=old.indexOf(MARK_B,i);
  if(i>=0&&j>i) return (old.slice(0,i)+block+old.slice(j+MARK_B.length)).trim();
  return (old.trim()?old.trim()+'\n\n':'')+block;
}

/* ---------- §7 rewrite one routine ---------- */
// changes = things that require a PUT; warnings = things to tell you that do not.
const clean=o=>Object.fromEntries(Object.entries(o).filter(([,v])=>v!==null&&v!==undefined));
function planRoutine(rt,cfgR,maxes,cfg){
  const changes=[], warnings=[]; const used={};
  const pairs=(rt.exercises||[]).map(ex=>{
    const n=used[ex.exercise_template_id]=(used[ex.exercise_template_id]||0)+1;
    return [ex,cfgR.exercises.filter(c=>c.templateId===ex.exercise_template_id)[n-1]];
  });
  const titleOf=c=>pairs.find(p=>p[1]===c)?.[0].title;
  const exercises=pairs.map(([ex,cx])=>{
    const name=ex.title||cx?.lift||ex.exercise_template_id;
    let sets=(ex.sets||[]).map(s=>clean({type:s.type,weight_kg:s.weight_kg,reps:s.reps,distance_meters:s.distance_meters,duration_seconds:s.duration_seconds,custom_metric:s.custom_metric,rep_range:s.rep_range}));
    let notes=ex.notes||null;
    const max=cx&&maxes[cx.lift]?.value;
    if(cx&&!max) warnings.push(`  ! ${name}: no week max for "${cx.lift}" — left as is`);
    if(cx&&max){
      const tm=trainingMax(max,cfg); let k=0;
      const leader=leaderOf(cfgR,cx);
      sets=sets.map(s=>{ if(s.type!=='normal') return s; const p=cx.sets[k++]; if(!p) return s;
        const w=setWeight(tm,p[0],cfg); const reps=isAmrap(p[1])?parseInt(p[1]):p[1];
        const wOld=s.weight_kg!=null?toUser(s.weight_kg,cfg.unit):null;
        if(wOld===null||Math.abs(wOld-w)>0.4||s.reps!==reps)
          changes.push(`  ${name} set ${k}: ${wOld!==null?fmt(wOld):'–'}×${s.reps??'–'} -> ${fmt(w)}×${reps} ${cfg.unit}`);
        const {rep_range,...rest}=s; return {...rest,weight_kg:toKg(w,cfg.unit),reps}; });
      if(k!==cx.sets.length) warnings.push(`  ! ${name}: Hevy has ${k} working sets, config has ${cx.sets.length} — only ${Math.min(k,cx.sets.length)} filled`);
      const block=amrapIndex(cx)>=0?noteFor(cx,max,cfg):leader?followerNoteFor(cx,leader,titleOf(leader)||leader.lift,max,cfg):null;
      if(block){ const nn=mergeNote(notes,block); if(nn!==notes){ notes=nn; changes.push(`  ${name}: note updated`);} }
    }
    return clean({exercise_template_id:ex.exercise_template_id,superset_id:ex.superset_id,rest_seconds:ex.rest_seconds,notes,sets});
  });
  return {body:clean({title:rt.title,notes:rt.notes,exercises}),changes,warnings};
}

module.exports={pct,e1rm,mround,ceilTo,toKg,toUser,isAmrap,trainingMax,setWeight,weekMax,ingestWorkout,noteFor,followerNoteFor,leaderOf,mergeNote,planRoutine,MARK_A,MARK_B,fmt};
