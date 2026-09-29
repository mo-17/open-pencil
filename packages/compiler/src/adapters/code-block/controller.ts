/** Emitted identically into both targets; only an explicit button action may call copy(). */
export const CODE_BLOCK_CONTROLLER_SOURCE = `type CodeCopyStatus='idle'|'pending'|'success'|'error'
interface CodeCopyOwner {key:string;code:string;enabled:boolean;alive:boolean}
function createCodeCopyController(read:()=>CodeCopyOwner,write:(code:string)=>Promise<void>,publish:(status:CodeCopyStatus)=>void) {
 let generation=0,disposed=false,pendingKey:string|null=null
 function reset():void {generation++;pendingKey=null;if(!disposed)publish('idle')}
 async function copy():Promise<void> {
  const owner=read()
  if(disposed||!owner.alive||!owner.enabled||pendingKey===owner.key)return
  const token=++generation
  pendingKey=owner.key;publish('pending')
  let status:CodeCopyStatus='success'
  try {await write(owner.code)} catch {status='error'}
  const current=read()
  if(disposed||token!==generation||!current.alive||!current.enabled||current.key!==owner.key)return
  pendingKey=null;publish(status)
 }
 function destroy():void {disposed=true;generation++;pendingKey=null}
 return {copy,reset,destroy}
}
`
