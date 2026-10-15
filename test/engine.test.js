const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../src/engine');
const CFG=require('../config.json');

const cfg={...CFG,maxRule:'top'};
const cfgSpec={...cfg,noteRpe:[10,9]};          // §10.3 / §7 as written in SPEC: two RPE blocks
const near=(a,b,d=0.005)=>assert.ok(a!==null&&Math.abs(a-b)<=d,`${a} !≈ ${b}`);
const T1_531=[[0.75,5],[0.85,3],[0.95,'1+'],[0.9,3],[0.85,3],[0.8,3],[0.75,5],[0.7,5],[0.65,5]];
const squat={templateId:'SQ',lift:'squat',sets:T1_531};

/* ---------- §4.1 RPE table ---------- */
test('§4.1 pct checks', ()=>{
  assert.equal(E.pct(10,1),1); assert.equal(E.pct(9.5,1),.978); assert.equal(E.pct(9,1),.955);
  assert.equal(E.pct(8,1),.922); assert.equal(E.pct(9,4),.863); assert.equal(E.pct(10,8),.786);
});
test('§4.1 RPE 10 with n reps = RPE 9 with n−1 reps', ()=>{
  for(let r=2;r<=20;r++) assert.equal(E.pct(10,r),E.pct(9,r-1));
});
test('§4.1 out of table is null, not a guess', ()=>{
  for(const [rpe,reps] of [[10,0],[10,21],[6,5],[9.25,3],[10,4.5],[null,3],[9,null]]) assert.equal(E.pct(rpe,reps),null,`${rpe}/${reps}`);
  assert.equal(E.pct(6.5,20),.3695);                 // deepest cell exists
});

/* ---------- §10.1 week max, maxRule "average" ---------- */
const WEEKS=[ // [bench, ohp, deadlift, squat] each [top, back|null], then expected B/O/D/S
  ['F1 S1',[[135,8,10],null],[[85,10,9.5],null],[[225,5,8],null],[[185,10,8],null],[171.76,117.57,277.44,272.06]],
  ['F1 S2',[[145,7,9],[100,15,8]],[[110,2,9],[70,14,9]],[[240,2,9.5],[165,15,8.5]],[[235,3,10],[150,15,9]],[183.98,118.08,275.51,258.56]],
  ['F1 S3',[[160,3,9.5],[105,19,10]],[[105,4,10],[70,16,10]],[[240,3,8],[165,18,9]],[[225,3,8],[155,16,9]],[195.13,120.05,307.07,272.56]],
  ['F2 S1',[[170,2,10],[105,20,10]],[[105,5,9.5],[75,14,9.5]],[[265,3,9],[175,12,7]],[[240,3,9.5],[155,15,8.5]],[202.15,122.94,294.62,271.07]],
  ['F2 S2',[[175,3,9.5],[115,20,9.5]],[[105,6,8],[80,17,9]],[[255,3,8.5],[170,17,8.5]],[[235,4,9],[165,13,8]],[224.11,144.01,313.70,273.88]],
  ['F2 S3',[[195,1,9.5],null],[[125,4,10],[85,15,10]],[[270,3,9],[180,17,8.5]],[[240,4,8],[170,13,8]],[199.39,141.02,329.74,285.27]],
];
const set=a=>a&&{w:a[0],r:a[1],rpe:a[2]};
for(const [wk,...rest] of WEEKS){
  const exp=rest.pop();
  ['bench','ohp','deadlift','squat'].forEach((lift,i)=>{
    test(`§10.1 ${wk} ${lift} average = ${exp[i]}`, ()=>{
      const [top,back]=rest[i];
      near(+E.weekMax(set(top),set(back),'average').max.toFixed(2),exp[i]);
    });
  });
}

/* ---------- §10.2 prescription of the 1+ ---------- */
for(const [max,tm,w] of [[202.15,185,175],[195.13,180,170],[329.74,300,285]]){
  test(`§10.2 max ${max} -> TM ${tm} -> 1+ ${w}`, ()=>{
    assert.equal(E.trainingMax(max,cfg),tm);
    assert.equal(E.setWeight(tm,0.95,cfg),w);
  });
}

/* ---------- §10.3 note rows + §7 note format ---------- */
test('§10.3 squat TM 260: 1+ @ 245 and the RPE 10 / RPE 9 rows for 4 reps', ()=>{
  assert.equal(E.trainingMax(285.3,cfg),260);
  const lines=E.noteFor(squat,285.3,cfgSpec).split('\n');
  assert.equal(lines[0],'⟦PL⟧');
  assert.equal(lines[1],'1+ @ 245 lb (set 3) — find your row, load the sets after it');
  assert.equal(lines[2],"(90%×3, 85%×3, 80%×3, 75%×5, 70%×5, 65%×5 of today's TM)");
  const r10=lines.indexOf('RPE 10'), r9=lines.indexOf('RPE 9');
  assert.ok(r10>0&&r9>r10);
  assert.equal(lines.slice(r10,r9).find(l=>l.startsWith(' 4 →')),' 4 → 225 · 215 · 200 · 190 · 175 · 165');
  assert.equal(lines.slice(r9).find(l=>l.startsWith(' 4 →')),' 4 → 235 · 220 · 210 · 195 · 180 · 170');
  // the two example rows printed in §7
  assert.equal(lines[r10+1],' 1 → 205 · 190 · 180 · 170 · 160 · 145');
  assert.equal(lines[r9+1],' 1 → 210 · 200 · 190 · 175 · 165 · 155');
  assert.equal(lines.at(-2),'TM 260 from week max 285.3');
  assert.equal(lines.at(-1),'⟦/PL⟧');
  assert.equal(lines.filter(l=>l.includes('→')).length,18);   // 9 reps × 2 RPEs
});

/* ---------- §10.4 maxRule "top" ---------- */
test('§10.4 1+ 245×4 @9, back-off 170×7 @9: top 283.9, average 250.1', ()=>{
  const top={w:245,r:4,rpe:9}, back={w:170,r:7,rpe:9};
  assert.equal(+E.weekMax(top,back,'top').max.toFixed(1),283.9);
  assert.equal(+E.weekMax(top,back,'average').max.toFixed(1),250.1);
});
test('§10.4 same case through a real-shaped Hevy workout (kg, warm-ups, normal sets)', ()=>{
  const kg=lb=>E.toKg(lb,'lb');
  const workout={id:'w1',routine_id:'r1',exercises:[{exercise_template_id:'SQ',sets:[
    {type:'warmup',weight_kg:kg(135),reps:5,rpe:null},
    {type:'normal',weight_kg:kg(195),reps:5,rpe:null},
    {type:'normal',weight_kg:kg(220),reps:3,rpe:null},
    {type:'normal',weight_kg:kg(245),reps:4,rpe:9},          // the 1+ (3rd working set)
    {type:'normal',weight_kg:kg(235),reps:3,rpe:8},
    {type:'normal',weight_kg:kg(170),reps:7,rpe:9},          // last set with RPE = back-off
    {type:'normal',weight_kg:kg(160),reps:5,rpe:null},
  ]}]};
  const cfgR={title:'Tuesday (Pull)',exercises:[squat]};
  const [r]=E.ingestWorkout(workout,cfgR,{...cfg,maxRule:'top'});
  assert.deepEqual(r.top,{w:245,r:4,rpe:9}); assert.deepEqual(r.back,{w:170,r:7,rpe:9});
  assert.equal(+r.max.toFixed(1),283.9);
  assert.equal(+E.ingestWorkout(workout,cfgR,{...cfg,maxRule:'average'})[0].max.toFixed(1),250.1);
});

/* ---------- §10.5 conversion ---------- */
test('§10.5 170 lb -> 77.111 kg -> 170.0 lb', ()=>{
  assert.equal(E.toKg(170,'lb'),77.111);
  assert.equal(E.toUser(77.111,'lb'),170);
});

/* ---------- §4.3 / §6 edge rules ---------- */
test('§4.3 1+ without RPE assumes 10 and says so', ()=>{
  const r=E.weekMax({w:245,r:4,rpe:null},null,'top');
  near(r.max,245/.892); assert.ok(r.warnings.includes('1+ RPE missing: assumed 10'));
});
test('§4.3 invalid 1+ falls back to back-off and warns', ()=>{
  const r=E.weekMax({w:135,r:25,rpe:9},{w:170,r:7,rpe:9},'top');
  near(r.max,170/.786); assert.ok(r.warnings.some(w=>w.includes('outside the RPE table')));
});
test('§6.5 nothing usable: no max, warning logged', ()=>{
  const r=E.weekMax({w:135,r:25,rpe:9},{w:100,r:5,rpe:5},'average');
  assert.equal(r.max,null); assert.ok(r.warnings.length>=2);
});

/* ---------- §7 routine rewrite ---------- */
const hevyRoutine=(sets,notes)=>({id:'r1',title:'Tuesday (Pull)',notes:null,folder_id:7,exercises:[
  {index:0,title:'Squat (Barbell)',exercise_template_id:'SQ',superset_id:null,rest_seconds:180,notes,sets},
  {index:1,title:'Leg Press',exercise_template_id:'LP',superset_id:null,rest_seconds:90,notes:'mine',sets:[{index:0,type:'normal',weight_kg:100,reps:12}]},
]});
const maxes={squat:{value:285.3}};
const nine=()=>[{type:'warmup',weight_kg:20,reps:10},...T1_531.map(()=>({type:'normal',weight_kg:50,reps:5,rep_range:null}))];

test('§7 weights, AMRAP reps, warm-ups and other exercises', ()=>{
  const {body,changes,warnings}=E.planRoutine(hevyRoutine(nine(),'My cue: brace'),{exercises:[squat]},maxes,cfg);
  const sq=body.exercises[0];
  assert.deepEqual(sq.sets[0],{type:'warmup',weight_kg:20,reps:10});
  assert.deepEqual(sq.sets.slice(1).map(s=>E.toUser(s.weight_kg,'lb')),[195,220,245,235,220,210,195,180,170]);
  assert.equal(sq.sets[3].reps,1);                                  // "1+" -> 1
  assert.ok(sq.notes.startsWith('My cue: brace\n\n⟦PL⟧'));
  assert.deepEqual(body.exercises[1],{exercise_template_id:'LP',rest_seconds:90,notes:'mine',sets:[{type:'normal',weight_kg:100,reps:12}]});
  assert.ok(!('folder_id' in body)&&!('notes' in body));            // no folder_id, no nulls
  assert.ok(!JSON.stringify(body).includes('null'));
  assert.ok(changes.length>0); assert.equal(warnings.length,0);
});
test('§7.5 note: only the ⟦PL⟧ block is replaced, my text is kept', ()=>{
  const old='before\n⟦PL⟧\nstale\n⟦/PL⟧\nafter';
  const merged=E.mergeNote(old,'⟦PL⟧\nnew\n⟦/PL⟧');
  assert.equal(merged,'before\n⟦PL⟧\nnew\n⟦/PL⟧\nafter');
});
test('§7.6 nothing changed -> no PUT', ()=>{
  const first=E.planRoutine(hevyRoutine(nine(),null),{exercises:[squat]},maxes,cfg);
  const again=E.planRoutine({...first.body,exercises:first.body.exercises.map(e=>({...e,title:'x'}))},{exercises:[squat]},maxes,cfg);
  assert.deepEqual(again.changes,[]);
});
test('§7.6 a reps-only difference is a change', ()=>{
  const first=E.planRoutine(hevyRoutine(nine(),null),{exercises:[squat]},maxes,cfg).body;
  first.exercises[0].sets[3].reps=5;
  assert.equal(E.planRoutine(first,{exercises:[squat]},maxes,cfg).changes.length,1);
});
test('§7.4 set-count mismatch: fill what matches, warn, and the warning alone is not a change', ()=>{
  const first=E.planRoutine(hevyRoutine(nine().slice(0,8),null),{exercises:[squat]},maxes,cfg);
  assert.ok(first.warnings[0].includes('Hevy has 7 working sets, config has 9'));
  const again=E.planRoutine(first.body,{exercises:[squat]},maxes,cfg);
  assert.deepEqual(again.changes,[]); assert.equal(again.warnings.length,1);
});
test('§7.2 same exercise twice in a routine is matched in order', ()=>{
  const a={templateId:'SQ',lift:'squat',sets:[[0.5,5]]}, b={templateId:'SQ',lift:'squat',sets:[[0.7,3]]};
  const rt={title:'t',exercises:[{exercise_template_id:'SQ',sets:[{type:'normal',weight_kg:1,reps:1}]},{exercise_template_id:'SQ',sets:[{type:'normal',weight_kg:1,reps:1}]}]};
  const {body}=E.planRoutine(rt,{exercises:[a,b]},maxes,cfg);
  assert.deepEqual(body.exercises.map(e=>E.toUser(e.sets[0].weight_kg,'lb')),[130,180]);   // TM 260
});

/* ---------- config matches §5 ---------- */
test('§5 config: AMRAP at index 2 on every T1 1+ day, Sat 3+ on set 3, percentages as in the Excel', ()=>{
  const T2=(a,b,c)=>[[a,6],[b,5],[c,3],[c,5],[c,7],[c,4],[c,6],[c,8]];
  const T2s=(a,b,c)=>[[a,5],...T2(a,b,c).slice(1)];   // sumo + front squat open with ×5 (Excel WEEK 1 F15, F23)
  const T1_DL=T1_531.map((s,i)=>i>=6?[s[0],3]:s);
  const BMON=[[0.65,8],[0.75,6],[0.85,4],[0.85,4],[0.85,4],[0.8,5],[0.75,6],[0.7,7],[0.65,8]];
  const want={
    'Monday (push)':[['bench',BMON],['ohp',T2(.5,.6,.7)]],
    'Tuesday (Pull)':[['squat',T1_531],['deadlift',T2s(.5,.6,.7)]],
    'Wednesday (Arms)':[['ohp',T1_531],['bench',T2(.4,.5,.6)]],
    'Thursday (Push)':[['deadlift',T1_DL],['squat',T2s(.35,.45,.55)]],
    'Friday (Pull)':[['bench',T1_531],['bench',T2(.4,.5,.6)]],
    'Saturday (Arms)':[['squat',[[.725,3],[.725,3],[.725,'3+'],...Array(5).fill([.725,3])]],['deadlift',Array(6).fill([.5625,3])]],
  };
  assert.deepEqual(CFG.routines.map(r=>r.title),Object.keys(want));
  for(const r of CFG.routines) assert.deepEqual(r.exercises.map(x=>[x.lift,x.sets]),want[r.title],r.title);
});

/* ---------- Diego's changes after the first live run ---------- */
const byTitle=t=>CFG.routines.find(r=>r.title===t);
const hevyFrom=cfgR=>({title:cfgR.title,exercises:cfgR.exercises.map((cx,i)=>({title:['Lift A','Lift B'][i],exercise_template_id:cx.templateId,
  sets:cx.sets.map(()=>({type:'normal',weight_kg:20,reps:1}))}))});
const stateMaxes={bench:{value:199.39},squat:{value:285.27},deadlift:{value:303.51},ohp:{value:162.69}};

test('notes carry only the RPE 10 block', ()=>{
  const note=E.noteFor(squat,285.3,cfg);
  assert.ok(note.includes('RPE 10')); assert.ok(!note.includes('RPE 9'));
  assert.equal(note.split('\n').filter(l=>l.includes('→')).length,cfg.noteReps.length);
});

test('Saturday: the note only says the 3+ is set 3 — no table, weights untouched', ()=>{
  const sat=byTitle('Saturday (Arms)');
  assert.equal(E.noteFor(sat.exercises[0],285.27,cfg),
    '⟦PL⟧\nSet 3 is the 3+ @ 190 lb — as many reps as you can\nThe other sets stay as loaded.\n⟦/PL⟧');
  const {body}=E.planRoutine(hevyFrom(sat),sat,stateMaxes,cfg);
  assert.deepEqual(body.exercises[0].sets.map(s=>[E.toUser(s.weight_kg,'lb'),s.reps]),Array(8).fill([190,3]));
});

test('Saturday 3+ never moves the squat week max', ()=>{
  const satR=byTitle('Saturday (Arms)'); const kg=lb=>E.toKg(lb,'lb');
  const w={exercises:[{exercise_template_id:satR.exercises[0].templateId,sets:Array.from({length:8},(_,i)=>({type:'normal',weight_kg:kg(190),reps:i===2?6:3,rpe:i===2?10:null}))}]};
  assert.deepEqual(E.ingestWorkout(w,satR,cfg),[]);
});

test('Friday: close-grip gets a note keyed to the bench 1+ of the same day', ()=>{
  const fri=byTitle('Friday (Pull)');
  const {body,changes}=E.planRoutine(hevyFrom(fri),fri,stateMaxes,cfg);
  const cg=body.exercises[1].notes.split('\n');
  assert.equal(cg[1],"Follows today's Lift A 1+ @ 170 lb — find that row");
  assert.ok(cg.includes(' 5 → 70 · 90 · 110 (6 sets)'));     // bench 170×5 @10 -> TM 180 = the preset
  assert.ok(cg.includes(' 4 → 70 · 90 · 105 (6 sets)'));     // bench 170×4 @10 -> TM 175
  assert.ok(changes.includes('  Lift B: note updated'));
  const tue=byTitle('Tuesday (Pull)');                        // different lift after the 1+: no note
  assert.equal(E.planRoutine(hevyFrom(tue),tue,stateMaxes,cfg).body.exercises[1].notes,undefined);
});

test("Tuesday's squat 1+ moves Thursday's front squat (and Saturday's squat)", ()=>{
  const tue=byTitle('Tuesday (Pull)'), thu=byTitle('Thursday (Push)'), sat=byTitle('Saturday (Arms)');
  const before=E.planRoutine(hevyFrom(thu),thu,stateMaxes,cfg).body.exercises[1].sets.map(s=>E.toUser(s.weight_kg,'lb'));
  assert.deepEqual(before,[90,115,145,145,145,145,145,145]);          // Excel WEEK 1 row 23, TM 260
  const kg=lb=>E.toKg(lb,'lb');
  const w={exercises:[{exercise_template_id:tue.exercises[0].templateId,sets:[195,220,245,235,220,210,195,180,170].map((lb,i)=>({type:'normal',weight_kg:kg(lb),reps:i===2?8:3,rpe:i===2?9:null}))}]};
  const [r]=E.ingestWorkout(w,tue,cfg);                              // 245×8 @9 -> e1RM 321.5 -> TM 290
  const maxes={...stateMaxes,squat:{value:r.max}};
  const after=E.planRoutine(hevyFrom(thu),thu,maxes,cfg).body.exercises[1].sets.map(s=>E.toUser(s.weight_kg,'lb'));
  assert.deepEqual(after,[100,130,160,160,160,160,160,160]);
  assert.equal(E.toUser(E.planRoutine(hevyFrom(sat),sat,maxes,cfg).body.exercises[0].sets[0].weight_kg,'lb'),210);
});
