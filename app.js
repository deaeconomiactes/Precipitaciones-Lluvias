const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const MONTHS_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const COLORS = ['#60a5fa','#22d3ee','#a78bfa','#fbbf24','#fb7185','#34d399'];
const state = { rainfall: [], anomalies: [], stations: [], metadata: {}, charts: {}, tableRows: [] };
const $ = id => document.getElementById(id);
const format = value => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(value || 0);
const average = values => values.length ? values.reduce((a,b)=>a+b,0)/values.length : 0;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    const [rainfall, anomalies, stations, metadata] = await Promise.all(
      ['rainfall.json','anomalies.json','stations.json','metadata.json'].map(name => fetch(`data/${name}`).then(r => {
        if (!r.ok) throw new Error(`No se pudo cargar ${name}`);
        return r.json();
      }))
    );
    Object.assign(state, { rainfall, anomalies, stations, metadata });
    populateFilters();
    wireFilters();
    render();
    $('headerCoverage').textContent = `${metadata.yearMin}–${metadata.yearMax}`;
    $('headerDepartments').textContent = metadata.departments.length;
    $('headerUpdated').textContent = new Date(metadata.generatedAt).toLocaleDateString('es-AR');
    $('latestDataYear').textContent = metadata.yearMax;
    $('dataNote').textContent = `Fuentes: ${metadata.rainfallSource} · ${metadata.anomalySource}`;
  } catch (error) {
    $('errorBanner').style.display = 'block';
    $('errorBanner').textContent = `${error.message}. Ejecutá el dashboard mediante un servidor HTTP local.`;
    console.error(error);
  } finally {
    $('loading').classList.add('hidden');
  }
}

function populateFilters() {
  fillSelect('departmentFilter', state.metadata.departments);
  const years=[...new Set(state.rainfall.map(r=>r.year))].sort((a,b)=>b-a);
  fillSelect('yearFilter', years);
  const latestCompleteYear=state.metadata.yearMax-1;
  if(years.includes(latestCompleteYear)) $('yearFilter').value=String(latestCompleteYear);
  fillSelect('annualFromFilter', [...years].reverse(), false);
  fillSelect('annualToFilter', [...years].reverse(), false);
  $('annualFromFilter').value=state.metadata.yearMin;
  $('annualToFilter').value=state.metadata.yearMax;
  MONTHS_FULL.forEach((month,index)=>$('monthFilter').add(new Option(month,index)));
  fillSelect('stationFilter', state.stations.map(s=>s.station), false);
}
function fillSelect(id, values, keepFirst=true) {
  const select=$(id); if(!keepFirst) select.innerHTML='';
  values.forEach(value=>select.add(new Option(value,value)));
}
function wireFilters() {
  ['departmentFilter','yearFilter','monthFilter','stationFilter'].forEach(id=>$(id).addEventListener('change',render));
  ['annualFromFilter','annualToFilter'].forEach(id=>$(id).addEventListener('change',()=>{
    let from=+$('annualFromFilter').value, to=+$('annualToFilter').value;
    if(from>to) [$('annualFromFilter').value,$('annualToFilter').value]=[String(to),String(from)];
    renderAnnual(filters());
  }));
  $('resetFilters').addEventListener('click',()=>{
    $('departmentFilter').value='ALL'; $('yearFilter').value='ALL'; $('monthFilter').value='ALL'; $('stationFilter').selectedIndex=0;
    $('annualFromFilter').value=state.metadata.yearMin; $('annualToFilter').value=state.metadata.yearMax; render();
  });
  document.querySelectorAll('.section-tab').forEach(button=>button.addEventListener('click',()=>{
    document.querySelectorAll('.section-tab').forEach(tab=>tab.classList.toggle('active',tab===button));
    document.querySelectorAll('.dashboard-panel').forEach(panel=>panel.classList.toggle('active',panel.id===button.dataset.panel));
    setTimeout(()=>Object.values(state.charts).forEach(chart=>chart.resize()),0);
  }));
  $('downloadTable').addEventListener('click',downloadTable);
}
function filters() {
  return { department:$('departmentFilter').value, year:$('yearFilter').value, month:$('monthFilter').value };
}
function filteredRainfall() {
  const f=filters();
  return state.rainfall.filter(r=>(f.department==='ALL'||r.department===f.department)&&(f.year==='ALL'||r.year===+f.year));
}
function recordValue(record, month) {
  return month==='ALL' ? record.months.reduce((s,v)=>s+(v||0),0) : (record.months[+month]||0);
}
function render() {
  const rows=filteredRainfall(), f=filters();
  updateKpis(rows,f); renderAnnual(f); renderMonthly(rows,f); renderRanking(rows,f); renderAnomalies(f);
  renderHeatmap(rows,f); renderClimate(); renderTable(rows,f); renderPriority(f);
}
function updateKpis(rows,f) {
  const values=rows.map(r=>recordValue(r,f.month)), total=values.reduce((a,b)=>a+b,0);
  let maximum={value:-1,row:null,month:null};
  rows.forEach(row=>row.months.forEach((v,m)=>{if((f.month==='ALL'||+f.month===m)&&v>maximum.value) maximum={value:v,row,month:m};}));
  const grouped=groupTotals(rows,r=>r.department,f.month), top=Object.entries(grouped).sort((a,b)=>b[1]-a[1])[0];
  $('kpiTotal').textContent=`${format(total)} mm`; $('kpiTotalDetail').textContent=f.month==='ALL'?'acumulado del período':'acumulado mensual';
  $('kpiTopDepartment').textContent=top?top[0]:'—'; $('kpiTopDepartmentDetail').textContent=top?`${format(top[1])} mm`:'sin datos';
}
function renderAnnual(f) {
  const from=+$('annualFromFilter').value, to=+$('annualToFilter').value;
  const rows=state.rainfall.filter(r=>(f.department==='ALL'||r.department===f.department)&&r.year>=from&&r.year<=to);
  const grouped=groupTotals(rows,r=>r.year,f.month), labels=Object.keys(grouped).sort((a,b)=>a-b);
  const divisor=f.department==='ALL'?new Set(rows.map(r=>r.department)).size:1;
  chart('annualChart','line',{labels,datasets:[dataset('Precipitación media',labels.map(y=>grouped[y]/divisor),COLORS[0],true)]},lineOptions('mm'));
}
function renderMonthly(rows) {
  const values=MONTHS.map((_,m)=>average(rows.map(r=>r.months[m]).filter(Number.isFinite)));
  chart('monthlyChart','bar',{labels:MONTHS,datasets:[dataset('Promedio mensual',values,COLORS[1])]},barOptions('mm'));
}
function renderRanking(rows,f) {
  const grouped=groupTotals(rows,r=>r.department,f.month), entries=Object.entries(grouped).sort((a,b)=>b[1]-a[1]).slice(0,15).reverse();
  chart('rankingChart','bar',{labels:entries.map(e=>e[0]),datasets:[dataset('Acumulado',entries.map(e=>e[1]),COLORS[0])]},barOptions('mm',true));
}
function renderAnomalies(f) {
  let rows=state.anomalies.filter(r=>f.department==='ALL'||r.department===f.department).sort((a,b)=>a.differenceMm-b.differenceMm);
  chart('anomalyChart','bar',{labels:rows.map(r=>r.department),datasets:[{...dataset('Diferencia',rows.map(r=>r.differenceMm),COLORS[4]),backgroundColor:rows.map(r=>r.differenceMm>=0?'rgba(34,211,238,.65)':'rgba(251,113,133,.7)')}]},barOptions('mm',true));
}
function renderHeatmap(rows,f) {
  const departments=[...new Set(rows.map(r=>r.department))].sort(), matrix=departments.map(d=>MONTHS.map((_,m)=>average(rows.filter(r=>r.department===d).map(r=>r.months[m]).filter(Number.isFinite))));
  const max=Math.max(1,...matrix.flat()), visible=f.month==='ALL'?[0,1,2,3,4,5,6,7,8,9,10,11]:[+f.month];
  let html='<div class="heatmap-grid"><div></div>'+visible.map(m=>`<div class="heat-cell heat-head">${MONTHS[m]}</div>`).join('');
  departments.forEach((department,i)=>{html+=`<div class="heat-label">${department}</div>`+visible.map(m=>{const v=matrix[i][m],alpha=.08+.85*(v/max);return `<div class="heat-cell" title="${department} · ${MONTHS_FULL[m]}: ${format(v)} mm" style="background:rgba(34,211,238,${alpha})">${format(v)}</div>`}).join('');});
  $('heatmap').innerHTML=html+'</div>';
}
function renderClimate() {
  const station=state.stations.find(s=>s.station===$('stationFilter').value)||state.stations[0], year=$('yearFilter').value;
  const rows=station.monthly.filter(r=>year==='ALL'||r.year===+year);
  const byMonth=MONTHS.map((_,m)=>rows.filter(r=>r.month===m+1));
  const metric=(key,mode='avg')=>byMonth.map(group=>mode==='sum'?group.reduce((s,r)=>s+(r[key]||0),0):average(group.map(r=>r[key]).filter(Number.isFinite)));
  $('stationCoverage').textContent=`${station.station} · ${rows.length} meses`;
  chart('climateChart','line',{labels:MONTHS,datasets:[
    {...dataset('Temperatura °C',metric('temperature'),COLORS[4]),yAxisID:'y'},
    {...dataset('Humedad %',metric('humidity'),COLORS[2]),yAxisID:'y'},
    {...dataset('Viento',metric('wind'),COLORS[3]),yAxisID:'y'},
    {...dataset('Lluvia acumulada del mes (mm)',metric('rain24Total','sum'),COLORS[1],true),yAxisID:'rain'}
  ]},{...lineOptions(''),scales:{x:axis(),y:{...axis(),position:'left'},rain:{...axis(),position:'right',grid:{drawOnChartArea:false}}}});
}
function renderTable(rows,f) {
  const grouped={}; rows.forEach(r=>{(grouped[r.department]??=[]).push(r)});
  state.tableRows=Object.entries(grouped).map(([department,records])=>{
    const vals=records.map(r=>recordValue(r,f.month)), total=vals.reduce((a,b)=>a+b,0); let peak={v:-1,m:0};
    records.forEach(r=>r.months.forEach((v,m)=>{if((f.month==='ALL'||+f.month===m)&&v>peak.v)peak={v,m}}));
    return {department,records:records.length,total,average:average(vals),maximum:peak.v,peakMonth:MONTHS_FULL[peak.m]};
  });
  $('detailsTable').innerHTML=state.tableRows.map(row=>`<tr><td>${row.department}</td><td>${row.records}</td><td>${format(row.total)} mm</td><td>${format(row.average)} mm</td><td>${format(row.maximum)} mm</td><td>${row.peakMonth}</td></tr>`).join('');
}
function priorityData(f) {
  const rows=state.rainfall.filter(r=>f.year==='ALL'||r.year===+f.year);
  const grouped={}; rows.forEach(row=>(grouped[row.department]??=[]).push(recordValue(row,f.month)));
  const entries=Object.entries(grouped).map(([department,values])=>({department,rain:average(values)})).sort((a,b)=>a.rain-b.rain);
  return entries.map((entry,index)=>{
    const score=entries.length>1?Math.round(index/(entries.length-1)*100):0;
    const level=score>=75?'Crítico':score>=50?'Alto':score>=25?'Medio':'Bajo';
    return {...entry,score,level};
  }).sort((a,b)=>b.score-a.score);
}
function renderPriority(f) {
  const all=priorityData(f), selected=f.department==='ALL'?all:all.filter(row=>row.department===f.department);
  $('kpiPriorityCount').textContent=all.filter(row=>row.level==='Alto'||row.level==='Crítico').length;
  $('prioritySummary').innerHTML=all.slice(0,7).map(row=>`<div class="priority-item"><span class="risk-dot ${riskClass(row.level)}"></span><div><strong>${row.department}</strong><br><small>${format(row.rain)} mm promedio</small></div><span class="priority-score">${row.score}</span></div>`).join('');
  $('riskTable').innerHTML=selected.map(row=>`<tr><td><span class="${riskClass(row.level)}">${row.level}</span></td><td>${row.department}</td><td>${row.score}/100</td><td>${format(row.rain)} mm</td><td>${riskReading(row.level)}</td></tr>`).join('');
}
function riskClass(level){return `risk-${level==='Crítico'?'critical':level==='Alto'?'high':level==='Medio'?'medium':'low'}`;}
function riskReading(level){return level==='Crítico'?'Revisión prioritaria':level==='Alto'?'Seguimiento cercano':level==='Medio'?'Monitoreo periódico':'Sin prioridad relativa';}
function downloadTable() {
  const headers=['Departamento','Registros','Acumulado_mm','Promedio_mm','Maximo_mm','Mes_maximo'];
  const lines=state.tableRows.map(row=>[row.department,row.records,row.total.toFixed(2),row.average.toFixed(2),row.maximum.toFixed(2),row.peakMonth].join(';'));
  const blob=new Blob(['\ufeff'+[headers.join(';'),...lines].join('\n')],{type:'text/csv;charset=utf-8'});
  const link=document.createElement('a'); link.href=URL.createObjectURL(blob); link.download='resumen_departamental.csv'; link.click(); URL.revokeObjectURL(link.href);
}
function groupTotals(rows,key,month){return rows.reduce((out,row)=>{const k=key(row);out[k]=(out[k]||0)+recordValue(row,month);return out},{});}
function dataset(label,data,color,fill=false){return{label,data,borderColor:color,backgroundColor:fill?`${color}20`:`${color}aa`,borderWidth:2,fill,tension:.3,pointRadius:2,borderRadius:5}}
function axis(){return{grid:{color:'rgba(52,86,104,.08)'},ticks:{color:'#617887',font:{family:'Inter',size:10}}}}
function lineOptions(unit){return{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{color:'#496473',usePointStyle:true}},tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${format(c.raw)} ${unit}`}}},scales:{x:axis(),y:axis()}}}
function barOptions(unit,horizontal=false){return{...lineOptions(unit),indexAxis:horizontal?'y':'x',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${format(c.raw)} ${unit}`}}}}}
function chart(id,type,data,options){if(state.charts[id])state.charts[id].destroy();state.charts[id]=new Chart($(id),{type,data,options});}
