/* Bright Health Alliance — Adaptive Dashboard Data Engine
 * Non-destructive client-specific data intelligence layer.
 * Does not mutate source rows. It detects fields, capabilities and supported KPIs.
 */
(function(global){
  'use strict';

  const ALIASES={
    claim_id:['claim_id','claim id','claim number','claim no','claim #','encounter id'],
    patient:['patient','patient name','member name'],
    service_date:['dos','date of service','service date','service_date'],
    claim_date:['claim date','claim_date','created date'],
    submitted_date:['submitted date','claim submitted date','first submitted date','claim_first_submitted_date'],
    charge_amount:['charge','charges','charge amount','billed amount','total charge','total charges'],
    payment_amount:['payment','payments','paid','paid amount','payment amount','posted amount','collections'],
    balance:['balance','ar balance','a/r balance','outstanding','outstanding amount','current balance','remaining balance'],
    allowed_amount:['allowed','allowed amount','contracted amount'],
    payer:['payer','insurance','insurance name','carrier','plan'],
    denial_code:['denial code','denial_code','reason code','carc'],
    denial_description:['denial description','denial_description','denial reason','reason'],
    denial_amount:['denial amount','denied amount'],
    aging_days:['days','age','aging days','days in ar','days in a/r'],
    aging_bucket:['bucket','aging bucket','age bucket','ar bucket','a/r bucket'],
    status:['status','claim status','denial status'],
    verification_status:['verification status','eligibility status','eligibility'],
    authorization_status:['authorization status','auth status','prior auth status'],
    deposit_amount:['deposit','deposit amount','total deposits']
  };

  const norm=s=>String(s??'').trim().toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ');
  const num=v=>{ if(v===null||v===undefined||v==='') return null; const n=Number(String(v).replace(/[$,%(),]/g,m=>m==='('?'-':'').replace(/\)/g,'')); return Number.isFinite(n)?n:null; };
  const date=v=>{ if(!v) return null; const d=new Date(v); return Number.isNaN(d.getTime())?null:d; };

  function detectColumns(rows){
    const headers=Object.keys((rows&&rows[0])||{});
    const normalized=new Map(headers.map(h=>[norm(h),h]));
    const mapping={};
    Object.entries(ALIASES).forEach(([field,aliases])=>{
      for(const alias of aliases){ const hit=normalized.get(norm(alias)); if(hit){ mapping[field]=hit; break; } }
    });
    return {headers,mapping,unmapped:headers.filter(h=>!Object.values(mapping).includes(h))};
  }

  function capabilities(mapping){
    const has=f=>Boolean(mapping[f]);
    return {
      charges:has('charge_amount'), payments:has('payment_amount'), ar:has('balance'),
      aging:has('aging_days')||has('aging_bucket'), denials:has('denial_code')||has('denial_description')||has('denial_amount'),
      payer:has('payer'), verification:has('verification_status'), priorAuth:has('authorization_status'),
      dates:has('service_date')||has('claim_date')||has('submitted_date'), claims:has('claim_id')
    };
  }

  function values(rows,mapping,field){
    const col=mapping[field]; if(!col) return [];
    return rows.map(r=>num(r[col])).filter(v=>v!==null);
  }
  const sum=a=>a.reduce((x,y)=>x+y,0);

  function metric(value,supported,meta={}){
    return supported ? {state:'available',value,...meta} : {state:'unavailable',value:null,...meta};
  }

  function buildProfile(rows,storedMapping){
    rows=Array.isArray(rows)?rows:[];
    const detected=detectColumns(rows);
    const mapping=Object.assign({},detected.mapping,storedMapping||{});
    const caps=capabilities(mapping);
    const charges=values(rows,mapping,'charge_amount');
    const payments=values(rows,mapping,'payment_amount');
    const balances=values(rows,mapping,'balance');
    const denialAmounts=values(rows,mapping,'denial_amount');
    const agingDays=values(rows,mapping,'aging_days');
    const claimCount=mapping.claim_id ? new Set(rows.map(r=>r[mapping.claim_id]).filter(Boolean)).size : rows.length;
    const denialRows=caps.denials ? rows.filter(r=>{
      const fields=['denial_code','denial_description','denial_amount'];
      return fields.some(f=>mapping[f] && r[mapping[f]]!==null && r[mapping[f]]!==undefined && String(r[mapping[f]]).trim()!=='');
    }) : [];
    const totalCharges=sum(charges), totalPayments=sum(payments), totalAR=sum(balances), totalDenials=sum(denialAmounts);
    const denialRate=(caps.denials && claimCount>0)?(denialRows.length/claimCount*100):null;
    const collectionRate=(caps.charges&&caps.payments&&totalCharges>0)?(totalPayments/totalCharges*100):null;
    const arOver90=(caps.ar&&caps.aging)?rows.reduce((acc,r)=>{
      const bal=num(r[mapping.balance])||0;
      const days=mapping.aging_days?num(r[mapping.aging_days]):null;
      const bucket=mapping.aging_bucket?norm(r[mapping.aging_bucket]):'';
      const old=(days!==null&&days>90)||/91|121|181|241|365/.test(bucket);
      return acc+(old?bal:0);
    },0):null;
    const avgDays=agingDays.length?sum(agingDays)/agingDays.length:null;

    return {
      mapping, unmapped:detected.headers.filter(h=>!Object.values(mapping).includes(h)), capabilities:caps,
      coverage:{rows:rows.length,mappedFields:Object.keys(mapping).length,totalFields:detected.headers.length},
      metrics:{
        totalCharges:metric(totalCharges,caps.charges,{format:'currency'}),
        collections:metric(totalPayments,caps.payments,{format:'currency'}),
        outstandingAR:metric(totalAR,caps.ar,{format:'currency'}),
        claimsSubmitted:metric(claimCount,caps.claims||rows.length>0,{format:'number'}),
        denialRate:metric(denialRate,caps.denials,{format:'percent'}),
        deniedAmount:metric(totalDenials,Boolean(mapping.denial_amount),{format:'currency'}),
        collectionRate:metric(collectionRate,caps.charges&&caps.payments,{format:'percent'}),
        daysInAR:metric(avgDays,Boolean(mapping.aging_days),{format:'days'}),
        arOver90:metric(arOver90,caps.ar&&caps.aging,{format:'currency'})
      }
    };
  }

  function dashboardPlan(profile){
    const c=profile.capabilities;
    return {
      kpis:Object.entries(profile.metrics).filter(([,m])=>m.state==='available').map(([key,m])=>({key,...m})),
      unavailable:Object.entries(profile.metrics).filter(([,m])=>m.state!=='available').map(([key,m])=>({key,...m})),
      sections:{
        revenue:c.charges||c.payments||c.ar,
        aging:c.ar&&c.aging,
        denials:c.denials,
        payer:c.payer,
        verification:c.verification,
        priorAuthorization:c.priorAuth,
        revenueLeakage:(c.ar&&c.aging)||c.denials||c.verification||c.priorAuth
      }
    };
  }

  function aggregateClientProfiles(profiles){
    const list=(profiles||[]).filter(Boolean); const keys=new Set();
    list.forEach(p=>Object.keys(p.metrics||{}).forEach(k=>keys.add(k)));
    const metrics={};
    keys.forEach(k=>{
      const reporting=list.filter(p=>p.metrics?.[k]?.state==='available');
      const vals=reporting.map(p=>Number(p.metrics[k].value)).filter(Number.isFinite);
      metrics[k]={state:reporting.length?'available':'unavailable',value:vals.length?sum(vals):null,reportingClients:reporting.length,totalClients:list.length,coverage:list.length?reporting.length/list.length:0};
    });
    return {metrics,totalClients:list.length};
  }

  global.BHAAdaptiveDashboard={ALIASES,detectColumns,capabilities,buildProfile,dashboardPlan,aggregateClientProfiles};
})(window);
