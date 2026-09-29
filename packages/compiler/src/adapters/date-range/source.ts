import { DATE_RANGE_LAYOUT, DATE_RANGE_MESSAGES } from '@open-pencil/core/plugins'

export const DATE_RANGE_CONFIG_SOURCE = `export interface OpenPencilDateRangeConfig {
 label:string; startLabel:string; endLabel:string; initialStart:string; initialEnd:string; min:string; max:string;
 disabled:boolean; readOnly?:boolean; allowClear:boolean; backgroundColor:string; textColor:string; borderColor:string; accentColor:string;
 fontSize:number; borderRadius:number
}
type DateRangeValues=[string,string]
const dateRangeMessages=${JSON.stringify(DATE_RANGE_MESSAGES)}
function dateRangeCopy(language:string){return language.toLowerCase().startsWith('zh')?dateRangeMessages.zh:dateRangeMessages.en}
function dateRangeLanguage(host:HTMLElement|null):string{return host?.closest('[lang]')?.getAttribute('lang')||'en'}
function dateRangeKey(c:OpenPencilDateRangeConfig):string{return JSON.stringify([c.label,c.startLabel,c.endLabel,c.initialStart,c.initialEnd,c.min,c.max,c.disabled,c.readOnly,c.allowClear,c.backgroundColor,c.textColor,c.borderColor,c.accentColor,c.fontSize,c.borderRadius])}
function dateRangeStyle(c:OpenPencilDateRangeConfig){return {background:c.backgroundColor,color:c.textColor,
 '--date-range-background':c.backgroundColor,'--date-range-border':c.borderColor,'--date-range-accent':c.accentColor,
 '--date-range-font':c.fontSize+'px','--date-range-radius':c.borderRadius+'px'}}
`
export const DATE_RANGE_VALUE_SOURCE = `function initialDateRange(config:OpenPencilDateRangeConfig):DateRangeValues{return [config.initialStart,config.initialEnd]}
function dateRangeStatus(values:DateRangeValues,config:OpenPencilDateRangeConfig):'empty'|'partial'|'ready'|'order'|'bounds'{
 if(values.some(value=>value&&((config.min&&value<config.min)||(config.max&&value>config.max))))return 'bounds'
 if(values[0]&&values[1])return values[0]>values[1]?'order':'ready'
 return values[0]||values[1]?'partial':'empty'
}
function changeDateRange(values:DateRangeValues,index:0|1,value:string,config:OpenPencilDateRangeConfig):DateRangeValues{
 if(config.disabled||config.readOnly)return values
 return index===0?[value,values[1]]:[values[0],value]
}`
const c = DATE_RANGE_LAYOUT
const HOST = '[data-openpencil-date-range]'
export const DATE_RANGE_STYLE_SOURCE = `${HOST}{box-sizing:border-box;min-width:0;max-width:100%;container-type:inline-size;overflow:auto;padding:${c.inset}px;font:var(--date-range-font)/${c.lineHeight} system-ui,sans-serif;border-radius:var(--date-range-radius)}
${HOST}[data-disabled=true]{opacity:.5}
${HOST} [data-date-range-title]{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;margin-bottom:${c.gap}px}
${HOST} [data-date-range-fields]{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:${c.gap}px}
${HOST} [data-date-range-field]{display:flex;flex-direction:column;gap:${c.labelGap}px;min-width:0}
${HOST} [data-date-range-caption]{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
${HOST} input[type=date]{box-sizing:border-box;width:100%;min-width:0;max-width:100%;height:${c.inputHeight}px;margin:0;padding:0 10px;background:var(--date-range-background);border:1px solid var(--date-range-border);border-radius:var(--date-range-radius);color:inherit;font:inherit;color-scheme:light}
${HOST} input[type=date]::-webkit-date-and-time-value{min-width:0;text-align:left}
${HOST} input[type=date]::-webkit-calendar-picker-indicator{flex:none;margin-left:4px;cursor:pointer}
${HOST} [data-date-range-footer]{display:flex;align-items:center;gap:${c.gap}px;min-height:${c.inputHeight}px;margin-top:${c.gap}px}
${HOST} [data-date-range-status]{margin:0;min-width:0;flex:1;overflow-wrap:anywhere;font-size:12px;line-height:1.4}
${HOST} [data-date-range-clear]{box-sizing:border-box;flex:none;width:${c.clearWidth}px;height:${c.inputHeight}px;border:1px solid var(--date-range-border);border-radius:var(--date-range-radius);background:var(--date-range-background);color:inherit;font:inherit;cursor:pointer;padding:0 4px}
${HOST} [data-date-range-clear]:disabled{opacity:.45;cursor:default}
${HOST} :is(input,button):focus-visible{outline:2px solid var(--date-range-accent);outline-offset:2px}
${HOST} [aria-invalid=true]{border-color:var(--date-range-accent)}
@container(max-width:${c.stackWidth - c.inset * 2 - 1}px){${HOST} [data-date-range-fields]{grid-template-columns:minmax(0,1fr)}}`

export const DATE_RANGE_FIELD_SOURCE = `function validModuleDate(value:unknown):value is string{
 if(typeof value!=='string'||!/^\\d{4}-\\d{2}-\\d{2}$/.test(value))return false
 const [year,month,day]=value.split('-').map(Number),date=new Date(year,month-1,day)
 return date.getFullYear()===year&&date.getMonth()===month-1&&date.getDate()===day
}
function dateRangeFields(config:OpenPencilDateRangeConfig,props:OpenPencilModuleRangeProps<string>,local:DateRangeValues){
 const fields=[moduleFieldValue(props.value,props.valueBound,local[0],validModuleDate,true),moduleFieldValue(props.endValue,props.endValueBound,local[1],validModuleDate,true)]
 return {fields,values:fields.map(field=>field.value??'') as DateRangeValues}
}`
