/** Dependency-free generated positioning shared by tooltip and click popover runtimes. */
export const FLOATING_POSITION_SOURCE = `type FloatingSide='top'|'right'|'bottom'|'left'
interface FloatingBox{left:number;top:number;width:number;height:number}
function floatingPosition(anchor:FloatingBox,size:{width:number;height:number},viewport:{width:number;height:number},preferred:FloatingSide,gap:number){
 const margin=8,space={top:anchor.top-margin,bottom:viewport.height-anchor.top-anchor.height-margin,left:anchor.left-margin,right:viewport.width-anchor.left-anchor.width-margin}
 const opposite:Record<FloatingSide,FloatingSide>={top:'bottom',bottom:'top',left:'right',right:'left'}
 const needed=(preferred==='top'||preferred==='bottom'?size.height:size.width)+gap
 const side=space[preferred]<needed&&space[opposite[preferred]]>space[preferred]?opposite[preferred]:preferred
 let left=anchor.left+(anchor.width-size.width)/2,top=anchor.top+(anchor.height-size.height)/2
 if(side==='top')top=anchor.top-size.height-gap
 if(side==='bottom')top=anchor.top+anchor.height+gap
 if(side==='left')left=anchor.left-size.width-gap
 if(side==='right')left=anchor.left+anchor.width+gap
 return {side,left:Math.max(margin,Math.min(left,viewport.width-size.width-margin)),top:Math.max(margin,Math.min(top,viewport.height-size.height-margin))}
}`
