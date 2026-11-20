/* BHA Adaptive Dashboard Runtime
 * Keeps AR / denials / payments / verification at their native row grain.
 * Builds one client-specific dashboard model without inventing zeroes for missing data.
 */
(function(global){
  'use strict';
  const E=()=>global.BHAAdaptiveDashboard;
  const MODULES=['ar','denials','payments','verification','priorAuthorization','charges'];
  const firstAvailable=(profiles,key)=>{
    for(const p of profiles){const m=p?.metrics?.[key];if(m?.state==='available')return m;}
    return {state:'unavailable',value:null};
  };
  const mergeCaps=profiles=>profiles.reduce((a,p)=>{Object.entries(p?.capabilities||{}).forEach(([k,v])=>a[k]=Boolean(a[k]||v));return a;},{});

  function buildClientModel(datasets={},savedMappings={}){
    if(!E()) throw new Error('adaptive-dashboard-engine.js must load first');
    const moduleProfiles={};
    MODULES.forEach(name=>{
      const rows=Array.isArray(datasets[name])?datasets[name]:[];
      if(rows.length) moduleProfiles[name]=E().buildProfile(rows,savedMappings[name]);
    });
    const profiles=Object.values(moduleProfiles);
    const capabilities=mergeCaps(profiles);
    const metrics={
      totalCharges:firstAvailable([moduleProfiles.charges,moduleProfiles.ar,...profiles].filter(Boolean),'totalCharges'),
      collections:firstAvailable([moduleProfiles.payments,moduleProfiles.ar,...profiles].filter(Boolean),'collections'),
      outstandingAR:firstAvailable([moduleProfiles.ar,...profiles].filter(Boolean),'outstandingAR'),
      claimsSubmitted:firstAvailable([moduleProfiles.charges,moduleProfiles.ar,...profiles].filter(Boolean),'claimsSubmitted'),
      denialRate:firstAvailable([moduleProfiles.denials,...profiles].filter(Boolean),'denialRate'),
      deniedAmount:firstAvailable([moduleProfiles.denials,...profiles].filter(Boolean),'deniedAmount'),
      daysInAR:firstAvailable([moduleProfiles.ar,...profiles].filter(Boolean),'daysInAR'),
      arOver90:firstAvailable([moduleProfiles.ar,...profiles].filter(Boolean),'arOver90')
    };
    const charge=metrics.totalCharges, pay=metrics.collections;
    metrics.collectionRate=(charge.state==='available'&&pay.state==='available'&&Number(charge.value)>0)
      ? {state:'available',value:Number(pay.value)/Number(charge.value)*100,format:'percent'}
      : {state:'unavailable',value:null,format:'percent'};
    const plan={
      kpis:Object.entries(metrics).filter(([,m])=>m.state==='available').map(([key,m])=>({key,...m})),
      unavailable:Object.entries(metrics).filter(([,m])=>m.state!=='available').map(([key,m])=>({key,...m})),
      sections:{
        revenue:metrics.totalCharges.state==='available'||metrics.collections.state==='available'||metrics.outstandingAR.state==='available',
        aging:metrics.arOver90.state==='available'||metrics.daysInAR.state==='available',
        denials:Boolean(moduleProfiles.denials),
        verification:Boolean(moduleProfiles.verification),
        priorAuthorization:Boolean(moduleProfiles.priorAuthorization),
        revenueLeakage:metrics.arOver90.state==='available'||metrics.deniedAmount.state==='available'||Boolean(moduleProfiles.verification)||Boolean(moduleProfiles.priorAuthorization)
      }
    };
    return {moduleProfiles,capabilities,metrics,plan,sourceModules:Object.keys(moduleProfiles)};
  }

  function buildAllClients(clientModels=[]){
    const models=clientModels.filter(Boolean), keys=new Set();
    models.forEach(m=>Object.keys(m.metrics||{}).forEach(k=>keys.add(k)));
    const metrics={};
    keys.forEach(key=>{
      const reporting=models.filter(m=>m.metrics?.[key]?.state==='available');
      const values=reporting.map(m=>Number(m.metrics[key].value)).filter(Number.isFinite);
      const percentLike=/Rate$/.test(key)||key==='denialRate';
      const value=values.length?(percentLike?values.reduce((a,b)=>a+b,0)/values.length:values.reduce((a,b)=>a+b,0)):null;
      metrics[key]={state:reporting.length?'available':'unavailable',value,reportingClients:reporting.length,totalClients:models.length,coverage:models.length?reporting.length/models.length:0};
    });
    return {metrics,totalClients:models.length};
  }

  function availabilityLabel(metric){
    if(!metric||metric.state!=='available') return 'Not available from current client data';
    return '';
  }

  global.BHAAdaptiveRuntime={buildClientModel,buildAllClients,availabilityLabel};
})(window);
