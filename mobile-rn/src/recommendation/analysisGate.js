let until=0;
export const pauseAnalysis=(ms=1500)=>{until=Math.max(until,Date.now()+ms);};
export const analysisInputIdle=()=>Date.now()>=until;
