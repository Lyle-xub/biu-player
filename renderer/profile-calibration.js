(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.BiuProfileCalibration=factory();})(typeof window==='object'?window:this,function(){
 function approved(value,modelId){
  return !!value && value.approved===true && value.modelId===modelId && typeof value.reviewedBy==='string' && !!value.reviewedBy.trim()
   && Number.isFinite(value.threshold)&&value.threshold>=0&&value.threshold<=1
   && value.testCount>=100 && value.totalCount>=200 && value.acceptedCount>=20 && value.positiveCount>=20 && value.negativeCount>=30
   && value.precision>=.95 && value.precision<=1 && typeof value.datasetHash==='string' && /^[a-f0-9]{64}$/.test(value.datasetHash);
 }
 function resolve(values,models){return Object.fromEntries(['text','image'].map(k=>[k,approved(values[k],models[k].id)?{approved:true,threshold:values[k].threshold}:{approved:false}]));}
 return {approved,resolve};
});
