import { CHART_MODULE_LIMITS } from '@open-pencil/core/plugins'

/** Explicit source preserves public names under production compiler minification. */
export const CHART_DATA_SOURCE = `const CHART_DATA_LIMITS=${JSON.stringify(CHART_MODULE_LIMITS)}
interface ChartData {values:number[];labels:string[]}
function chartDataArray(value:unknown,kind:'number'|'string'):(number|string)[]|null{
 if(!Array.isArray(value))return null
 const length:unknown=Object.getOwnPropertyDescriptor(value,'length')?.value
 if(typeof length!=='number'||!Number.isInteger(length)||length<0||length>CHART_DATA_LIMITS.values||Reflect.ownKeys(value).length!==length+1)return null
 const result:(number|string)[]=[]
 for(let index=0;index<length;index++){
  const descriptor=Object.getOwnPropertyDescriptor(value,String(index));if(!descriptor||!Object.hasOwn(descriptor,'value'))return null
  const entry:unknown=descriptor.value
  if(kind==='number'){if(typeof entry!=='number'||!Number.isFinite(entry)||Math.abs(entry)>CHART_DATA_LIMITS.value)return null}else if(typeof entry!=='string'||entry.length>CHART_DATA_LIMITS.label)return null
  result.push(entry as number|string)
 }return result
}
function chartData(value:unknown,chartType:OpenPencilChartConfig['chartType']):ChartData|null{
 try{
  if(value===null||typeof value!=='object'||Array.isArray(value))return null
  const prototype=Object.getPrototypeOf(value);if(prototype!==null&&prototype!==Object.prototype)return null
  const keys=Reflect.ownKeys(value);if(keys.length!==2||!keys.includes('values')||!keys.includes('labels'))return null
  const values=Object.getOwnPropertyDescriptor(value,'values'),labels=Object.getOwnPropertyDescriptor(value,'labels')
  if(!values||!labels||!Object.hasOwn(values,'value')||!Object.hasOwn(labels,'value'))return null
  const numbers=chartDataArray(values.value,'number') as number[]|null,names=chartDataArray(labels.value,'string') as string[]|null
  if(!numbers||!names||numbers.length!==names.length)return null
  if((chartType==='pie'||chartType==='donut')&&numbers.some(entry=>entry<0))return null
  return {values:numbers,labels:names}
 }catch{return null}
}
function chartSnapshot(authored:OpenPencilChartConfig,data:unknown,bound:boolean){
 if(!bound)return {config:authored,invalid:false,emptyData:false}
 const parsed=chartData(data,authored.chartType),config={...authored,...(parsed??{values:[],labels:[]})}
 return {config:{...config,layout:chartGeometry(config,authored.layout.width,authored.layout.height)},invalid:parsed===null,emptyData:parsed!==null&&parsed.values.length===0}
}`
