// Input: {kind, reviewedBy, samples:[{id,group,split:'calibration'|'test',score,label:boolean}]}.
// Scores must come from the pinned production preprocessing/model. Do not label with the model being evaluated.
const fs=require('node:fs'),crypto=require('node:crypto'),models=require('../renderer/profile-models.json');
const {approved}=require('../renderer/profile-calibration');
const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node scripts/calibrate-profile.cjs labeled-scores.json report.json');
const raw=fs.readFileSync(input),data=JSON.parse(raw),ids=new Set(),groups=new Map();
if(!models[data.kind]||typeof data.reviewedBy!=='string'||!data.reviewedBy.trim()||!Array.isArray(data.samples))throw Error('Missing reviewed labels');
for(const s of data.samples){
 if(!s.id||!s.group||ids.has(s.id)||typeof s.label!=='boolean'||!Number.isFinite(s.score)||s.score<0||s.score>1||!['calibration','test'].includes(s.split))throw Error('Invalid or duplicate sample');
 ids.add(s.id);if(groups.has(s.group)&&groups.get(s.group)!==s.split)throw Error('Near-duplicate group leaks between calibration and test');groups.set(s.group,s.split);
}
const train=data.samples.filter(s=>s.split==='calibration'),test=data.samples.filter(s=>s.split==='test');
if(train.length<50||test.length<100||data.samples.length<200||train.filter(s=>!s.label).length<20||train.filter(s=>s.label).length<20||test.filter(s=>!s.label).length<30||test.filter(s=>s.label).length<20)throw Error('Insufficient independently labeled samples');
const metrics=(samples,threshold)=>{const accepted=samples.filter(s=>s.score>=threshold),truePositive=accepted.filter(s=>s.label).length;return {acceptedCount:accepted.length,precision:accepted.length?truePositive/accepted.length:0,recall:truePositive/Math.max(1,samples.filter(s=>s.label).length)};};
const choices=[...new Set(train.map(s=>s.score))].map(threshold=>({threshold,...metrics(train,threshold)})).filter(v=>v.precision>=.95&&v.acceptedCount>=20).sort((a,b)=>b.recall-a.recall||b.precision-a.precision||b.threshold-a.threshold);
const threshold=choices[0]?.threshold??1;
const report={approved:!!choices.length,positiveCount:test.filter(s=>s.label).length,negativeCount:test.filter(s=>!s.label).length,modelId:models[data.kind].id,reviewedBy:data.reviewedBy,datasetHash:crypto.createHash('sha256').update(raw).digest('hex'),threshold,totalCount:data.samples.length,testCount:test.length,...metrics(test,threshold)};
report.approved=!!choices.length&&approved(report,report.modelId);fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
