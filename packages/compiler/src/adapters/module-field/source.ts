/** Shared generated contract for reviewed module controls; no form is inferred from visual nesting. */
export const MODULE_FIELD_TYPES_SOURCE = `export interface OpenPencilModuleField {
 name?:string; required?:boolean; invalid?:boolean; describedBy?:string;
 validationKey?:string; validationScopeMarker?:boolean; onBlur?:()=>void; onReset?:()=>void; error?:string
}
export interface OpenPencilModuleValueProps<T> {
 value?:unknown; valueBound?:boolean; onValueChange?:(value:T)=>void;
 field?:OpenPencilModuleField; form?:string; readOnly?:boolean; disabled?:boolean
}
export interface OpenPencilModuleRangeProps<T> extends OpenPencilModuleValueProps<T> {
 endValue?:unknown; endValueBound?:boolean; onEndValueChange?:(value:T)=>void; endField?:OpenPencilModuleField
}
interface ModuleFieldValue<T> { value:T|undefined; invalid:boolean; empty:boolean }
function moduleFieldValue<T>(raw:unknown,bound:boolean|undefined,local:T,valid:(value:unknown)=>value is T,allowEmpty=false):ModuleFieldValue<T>{
 const value=bound?raw:local
 if(value==='')return {value:undefined,invalid:!allowEmpty,empty:true}
 if(value===undefined||value===null)return {value:undefined,invalid:!!bound,empty:true}
 return valid(value)?{value,invalid:false,empty:false}:{value:undefined,invalid:true,empty:false}
}
function moduleFieldChinese(host:HTMLElement|null,language?:string):boolean{return (language??host?.closest('[lang]')?.getAttribute('lang')??'en').toLowerCase().startsWith('zh')}
function moduleFieldMessage(invalid:boolean,empty:boolean,field:OpenPencilModuleField|undefined,zh:boolean):string{
 if(field?.error)return field.error
 if(invalid||field?.invalid)return zh?'当前值无效，请重新选择。':'The current value is invalid. Choose a new value.'
 if(field?.required&&empty)return zh?'请选择一个值。':'Choose a value.'
 return ''
}
function moduleFieldDescription(local:string|undefined,field:OpenPencilModuleField|undefined):string|undefined{return [local,field?.describedBy].filter(Boolean).join(' ')||undefined}
`

export const MODULE_FIELD_RUNTIME_SOURCE = `function refreshModuleFields(host:HTMLElement|null):void{
 if(!host)return
 for(const input of host.querySelectorAll<HTMLInputElement>('[data-module-field-proxy]')){
  if(input.closest('[data-module-field-owner]')!==host)continue
  input.value=input.getAttribute('data-module-field-value')||''
  input.setCustomValidity(input.disabled||input.readOnly?'':input.getAttribute('data-module-field-message')||'')
 }
 for(const input of host.querySelectorAll<HTMLInputElement>('input[data-module-field-display]')){if(input.closest('[data-module-field-owner]')===host)input.value=input.getAttribute('data-module-field-display')||''}
}
function mountModuleFieldReset(host:HTMLElement|null,restore:()=>void,form:()=>string|undefined,fields:()=>readonly (OpenPencilModuleField|undefined)[]=()=>[]):()=>void{
 if(!host)return ()=>{}
 const doc=host.ownerDocument,win=doc.defaultView
 if(!win)return ()=>{}
 let disposed=false
 const timers=new Set<number>()
 const owner=()=>{const id=form();if(id!==undefined){const element=doc.getElementById(id);return element instanceof HTMLFormElement?element:null}return host.closest('form')}
 const reset=(event:Event)=>{
  if(event.target!==owner())return
  const expected=event.target,identity=JSON.stringify(fields().map(field=>[field?.name,field?.validationKey])),timer=win.setTimeout(()=>{timers.delete(timer);if(!disposed&&!event.defaultPrevented&&host.isConnected&&owner()===expected&&JSON.stringify(fields().map(field=>[field?.name,field?.validationKey]))===identity){restore();for(const field of fields()){if(disposed||!host.isConnected||owner()!==expected)break;field?.onReset?.();}queueMicrotask(()=>{if(!disposed&&host.isConnected)refreshModuleFields(host)})}},0)
  timers.add(timer)
 }
 doc.addEventListener('reset',reset,true)
 return()=>{disposed=true;doc.removeEventListener('reset',reset,true);for(const timer of timers)win.clearTimeout(timer);timers.clear()}
}
function moduleFieldInvalid(event:Event,host:HTMLElement|null,index:number):void{
 event.preventDefault()
 const target=host?.querySelector<HTMLElement>('[data-module-field-control="'+index+'"]')
 if(target&&!target.matches(':disabled,[aria-disabled=true]'))target.focus()
}
`

export const MODULE_FIELD_STYLE_SOURCE = `[data-module-field-proxy]{position:absolute!important;width:1px!important;height:1px!important;margin:0!important;padding:0!important;border:0!important;clip-path:inset(50%)!important;overflow:hidden!important;white-space:nowrap!important}
[data-module-field-status],[data-module-field-error]{font-size:12px;line-height:1.4;overflow-wrap:anywhere;margin:4px 0 0}
`

export const MODULE_FIELD_ATTRIBUTES_SOURCE = `function moduleFieldControl(field:OpenPencilModuleField|undefined,message:string,description:string|undefined,index:number){return {
 'data-module-field-control':index,'data-openpencil-validation-key':field?.validationScopeMarker?field.validationKey:undefined,
 'data-openpencil-validation-field-key':field?.validationKey,'aria-invalid':message?true:undefined,
 'aria-required':field?.required||undefined,'aria-describedby':moduleFieldDescription(description,field),onBlur:field?.onBlur
}}
interface ModuleFieldProxyProps {field?:OpenPencilModuleField;value:string;message:string;form?:string;disabled:boolean;readOnly?:boolean;index:number;focus:()=>void}
function moduleFieldProxyAttributes(props:ModuleFieldProxyProps){return {
 type:'text',name:props.field?.name,value:props.value,form:props.form,disabled:props.disabled,readOnly:props.readOnly,
 tabIndex:-1,'aria-hidden':true as const,'data-module-field-proxy':props.index,'data-module-field-message':props.message,'data-module-field-value':props.value,
 onInvalid:(event:Event)=>{event.preventDefault();const input=event.target;if(!(input instanceof HTMLInputElement))return;const first=input.form?Array.from(input.form.elements).find(element=>(element instanceof HTMLInputElement||element instanceof HTMLSelectElement||element instanceof HTMLTextAreaElement)&&element.willValidate&&!element.validity.valid):input;if(first===input)props.focus()}
}}
`

export const MODULE_FIELD_REACT_SOURCE = `function ModuleFieldProxy(props:ModuleFieldProxyProps){
 if(!props.field)return null
 const {onInvalid,...attributes}=moduleFieldProxyAttributes(props)
 return <><input {...attributes} onInvalid={event=>onInvalid(event.nativeEvent)} onChange={()=>{}} />{props.field.error&&<p data-module-field-error="" role="alert" id={props.field.describedBy}>{props.field.error}</p>}</>
}`

/** The owning SFC imports h; returning a real native input also preserves SSR FormData shape. */
export const MODULE_FIELD_VUE_SOURCE = `function ModuleFieldProxy(props:ModuleFieldProxyProps){if(!props.field)return null;return [h('input',moduleFieldProxyAttributes(props)),props.field.error?h('p',{'data-module-field-error':'',role:'alert',id:props.field.describedBy},props.field.error):null]}
ModuleFieldProxy.props=['field','value','message','form','disabled','readOnly','index','focus']`
