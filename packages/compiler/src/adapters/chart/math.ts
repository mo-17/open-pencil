/** Typed, dependency-free single-series geometry. Core parity is checked for all chart types. */
export const CHART_MATH_SOURCE = `
const chartPalette=['#0D9488','#D97706','#9333EA','#DB2777','#0284C7','#4D7C0F','#DC2626']
function chartNumber(value:number){return Math.round(value*1000)/1000}
function chartLabel(text:string,width:number,fontSize:number){const normalized=text.replaceAll(/[\\r\\n\\t]/g,' '),chars=Array.from(normalized),capacity=Math.floor(width/fontSize);return capacity<=0?'':chars.length<=capacity?normalized:chars.slice(0,capacity-1).join('')+'…'}
function chartAddText(model:ChartMutableLayout,fullText:string,box:{x:number;y:number;width:number;align:'left'|'center'|'right'},kind:ChartText['kind']='category',count=0){
 const x=Math.max(0,box.x),y=Math.max(0,box.y),width=Math.max(0,Math.min(box.width,model.width-x)),height=18
 if(width<12||y+height>model.height)return
 model.texts.push({text:chartLabel(fullText,width,12),fullText,kind,count,x:chartNumber(x),y:chartNumber(y),width:chartNumber(width),height,fontSize:12,align:box.align,color:'#334155',fontWeight:400})
}
function chartHiddenText(model:ChartMutableLayout,x:number,y:number,width:number){if(model.hiddenLabelCount>0)chartAddText(model,'+'+model.hiddenLabelCount,{x,y,width,align:'right'},'overflow',model.hiddenLabelCount)}
function chartCartesian(config:OpenPencilChartConfig,model:ChartMutableLayout){
 const {width,height}=model,inset=Math.min(16,width*.08,height*.08),plotWidth=width-inset*2,step=plotWidth/config.values.length,stride=Math.max(1,Math.ceil(config.labels.length/Math.max(1,Math.floor(plotWidth/52))))
 const labelBand=model.compact?0:22,requestedValues=!model.compact&&config.showValues&&step>=44,requestedOverflowBand=requestedValues&&stride>1?20:0,requestedNegativeBand=requestedValues&&config.values.some(value=>value<0)?24:0
 const showValues=requestedValues&&height-inset*2-labelBand-20-requestedOverflowBand-requestedNegativeBand>=12,overflowBand=showValues?requestedOverflowBand:0,negativeValueBand=showValues?requestedNegativeBand:0,topBand=model.compact?0:20+overflowBand
 const left=inset,right=width-inset,top=inset+topBand,bottom=Math.max(top,height-inset-labelBand-negativeValueBand),plotHeight=bottom-top,min=Math.min(0,...config.values),max=Math.max(0,...config.values),lower=min===max?-1:min,upper=min===max?1:max
 const y=(value:number)=>chartNumber(top+((upper-value)/(upper-lower))*plotHeight),x=(index:number)=>chartNumber(left+step*(index+.5)),zero=y(0)
 model.paths.push({d:'M'+chartNumber(left)+' '+zero+'H'+chartNumber(right),fill:'none',stroke:'#CBD5E1',strokeWidth:Math.min(1,inset),opacity:1})
 if(config.chartType==='bar'){
  const gap=Math.min(12,step*.24);config.values.forEach((value,index)=>model.rects.push({x:chartNumber(left+step*index+gap/2),y:Math.min(y(value),zero),width:chartNumber(Math.max(0,step-gap)),height:chartNumber(Math.abs(y(value)-zero)),radius:0,fill:config.color,opacity:1}))
 }else{
  const line=config.values.map((value,index)=>(index?'L':'M')+x(index)+' '+y(value)).join('')
  if(config.chartType==='area')model.paths.push({d:line+'L'+x(config.values.length-1)+' '+zero+'L'+x(0)+' '+zero+'Z',fill:config.color,stroke:'none',strokeWidth:0,opacity:.16})
  model.paths.push({d:line,fill:'none',stroke:config.color,strokeWidth:Math.min(2,inset),opacity:1})
  config.values.forEach((value,index)=>model.circles.push({x:x(index),y:y(value),radius:Math.min(3,step/3,plotHeight/4,inset/2),fill:config.color,stroke:'#FFFFFF',strokeWidth:Math.min(1,inset/2),opacity:1}))
 }
 if(model.compact){model.hiddenLabelCount=config.labels.length;return}
 let visible=0;for(let first=0;first<config.labels.length;first+=stride){const count=Math.min(stride,config.labels.length-first),index=first+Math.floor((count-1)/2);chartAddText(model,config.labels[index],{x:left+first*step,y:height-inset-18,width:count*step-4,align:'center'});visible++}
 model.hiddenLabelCount=config.labels.length-visible;chartHiddenText(model,left,inset,plotWidth)
 if(showValues)config.values.forEach((value,index)=>chartAddText(model,String(value),{x:x(index)-step/2,y:value>=0?Math.max(inset+overflowBand,y(value)-20):y(value)+6,width:step-2,align:'center'},'value'))
}
function chartArcPoint(cx:number,cy:number,radius:number,angle:number){return chartNumber(cx+Math.cos(angle)*radius)+' '+chartNumber(cy+Math.sin(angle)*radius)}
function chartSlicePath(cx:number,cy:number,radius:number,inner:number,from:number,to:number){
 const mid=(from+to)/2,outer='M'+chartArcPoint(cx,cy,radius,from)+'A'+radius+' '+radius+' 0 0 1 '+chartArcPoint(cx,cy,radius,mid)+'A'+radius+' '+radius+' 0 0 1 '+chartArcPoint(cx,cy,radius,to)
 return !inner?outer+'L'+cx+' '+cy+'Z':outer+'L'+chartArcPoint(cx,cy,inner,to)+'A'+inner+' '+inner+' 0 0 0 '+chartArcPoint(cx,cy,inner,mid)+'A'+inner+' '+inner+' 0 0 0 '+chartArcPoint(cx,cy,inner,from)+'Z'
}
function chartEmptyCircular(model:ChartMutableLayout){
 model.empty=true;const {width,height}=model,radius=Math.max(0,Math.min(24,width/4,height/5)),cy=height/2-(model.compact?0:14)
 model.circles.push({x:width/2,y:cy,radius,fill:'none',stroke:'#CBD5E1',strokeWidth:Math.min(2,radius/2),opacity:1})
 if(!model.compact)chartAddText(model,'',{x:8,y:cy+radius+6,width:width-16,align:'center'},'empty')
}
function chartCircular(config:OpenPencilChartConfig,model:ChartMutableLayout){
 const total=config.values.reduce((sum,value)=>sum+value,0);if(!total){chartEmptyCircular(model);return}
 const {width,height}=model,inset=Math.min(16,width*.08,height*.08),wide=width>=300&&height>=140,rowSpace=wide?height-inset*2:Math.min(80,height*.3),maxRows=model.compact?0:Math.max(0,Math.floor(rowSpace/20)-1),rows=Math.min(maxRows,config.labels.length)
 model.hiddenLabelCount=config.labels.length-rows
 const legendWidth=wide?Math.min(150,width*.42):width-inset*2,legendHeight=rows*20+(model.hiddenLabelCount&&!model.compact?20:0),diskWidth=wide?width-inset*3-legendWidth:width-inset*2,diskHeight=wide?height-inset*2:height-inset*2-legendHeight,radius=chartNumber(Math.max(0,Math.min(diskWidth,diskHeight)/2-2)),cx=chartNumber(inset+diskWidth/2),cy=chartNumber(inset+diskHeight/2)
 if(radius<=0){model.compact=true;model.hiddenLabelCount=config.labels.length;return}
 const inner=config.chartType==='donut'?chartNumber(radius*.58):0,colors=config.values.map((_,index)=>index?chartPalette[(index-1)%chartPalette.length]:config.color);let angle=-Math.PI/2
 config.values.forEach((value,index)=>{if(!value)return;const end=angle+value/total*Math.PI*2;model.paths.push({d:chartSlicePath(cx,cy,radius,inner,angle,end),fill:colors[index],stroke:'#FFFFFF',strokeWidth:Math.min(1.5,radius/4),opacity:1});angle=end})
 const legendX=wide?width-inset-legendWidth:inset,legendY=wide?Math.max(inset,(height-legendHeight)/2):height-inset-legendHeight
 for(let index=0;index<rows;index++){const y=legendY+index*20;model.circles.push({x:legendX+4,y:y+9,radius:3.5,fill:colors[index],stroke:'none',strokeWidth:0,opacity:1});chartAddText(model,config.labels[index]+(config.showValues?' · '+config.values[index]:''),{x:legendX+14,y,width:legendWidth-14,align:'left'})}
 if(!model.compact)chartHiddenText(model,legendX,legendY+rows*20,legendWidth)
}
function chartGeometry(config:OpenPencilChartConfig,width:number,height:number):ChartLayout{
 const safeWidth=Number.isFinite(width)?Math.max(0,width):0,safeHeight=Number.isFinite(height)?Math.max(0,height):0,model:ChartMutableLayout={width:safeWidth,height:safeHeight,backgroundColor:'#FFFFFF',empty:false,compact:safeWidth<80||safeHeight<80,paths:[],rects:[],circles:[],texts:[],hiddenLabelCount:0}
 if(!config.values.length){model.empty=true;if(!model.compact)chartAddText(model,'',{x:8,y:safeHeight/2-9,width:safeWidth-16,align:'center'},'empty');return model}
 if(!safeWidth||!safeHeight){model.compact=true;model.hiddenLabelCount=config.labels.length;return model}
 if(config.chartType==='pie'||config.chartType==='donut')chartCircular(config,model);else chartCartesian(config,model)
 return model
}
`
