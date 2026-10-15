// Same RPE engine as the PL Tracker / your Excel (RPE sheet BD7:BX14).
const SEQ_A=[1,.955,.922,.892,.863,.837,.811,.786,.762,.739,.707,.68,.653,.626,.599,.572,.545,.518,.491,.464,.437,.41,.383,.356,.329,.302];
const SEQ_B=[.978,.939,.907,.878,.85,.824,.799,.774,.751,.723,.694,.667,.64,.613,.586,.5585,.5315,.5045,.4775,.4505,.4235,.3965,.3695,.3425,.3155,.2885];
const RPES=[10,9.5,9,8.5,8,7.5,7,6.5];
function pct(rpe,reps){
  reps=Math.round(+reps); rpe=+rpe;
  if(!(reps>=1&&reps<=20)||!RPES.includes(rpe)) return null;
  const whole=Number.isInteger(rpe);
  return (whole?SEQ_A:SEQ_B)[reps-1+(whole?10-rpe:9.5-rpe)] ?? null;
}
const e1rm=(w,r,rpe)=>{ const p=pct(rpe,r); return w>0&&p?w/p:null; };
const mround=(x,m)=>Math.round(x/m+1e-9)*m;          // Excel MROUND (halves round up)
const ceilTo=(x,m)=>Math.ceil(x/m-1e-9)*m;            // Excel CEILING
module.exports={pct,e1rm,mround,ceilTo};
