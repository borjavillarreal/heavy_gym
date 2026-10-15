const BASE='https://api.hevyapp.com/v1';
const KEY=process.env.HEVY_API_KEY;
async function call(method,path,body){
  if(!KEY) throw new Error('HEVY_API_KEY is not set');
  const res=await fetch(BASE+path,{method,headers:{'api-key':KEY,'content-type':'application/json',accept:'application/json'},body:body?JSON.stringify(body):undefined});
  const txt=await res.text();
  if(!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${txt.slice(0,400)}`);
  return txt?JSON.parse(txt):{};
}
async function allPages(path,key){
  const out=[]; for(let page=1;page<=50;page++){
    const r=await call('GET',`${path}${path.includes('?')?'&':'?'}page=${page}&pageSize=10`);
    out.push(...(r[key]||[])); if(!r.page_count||page>=r.page_count) break;
  } return out;
}
module.exports={
  recentWorkouts:async(n=10)=>(await call('GET',`/workouts?page=1&pageSize=${n}`)).workouts||[],
  routines:()=>allPages('/routines','routines'),
  templates:()=>allPages('/exercise_templates','exercise_templates'),
  getRoutine:async(id)=>{ const r=await call('GET',`/routines/${id}`); return r.routine||r; },
  putRoutine:(id,routine)=>call('PUT',`/routines/${id}`,{routine})
};
