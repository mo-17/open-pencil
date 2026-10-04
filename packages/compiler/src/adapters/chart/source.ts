export const CHART_CONFIG_SOURCE = `interface ChartPaint { fill:string;opacity:number }
interface ChartPath extends ChartPaint { d:string;stroke:string;strokeWidth:number }
interface ChartRect extends ChartPaint { x:number;y:number;width:number;height:number;radius:number }
interface ChartCircle extends ChartPaint { x:number;y:number;radius:number;stroke:string;strokeWidth:number }
interface ChartText { text:string;fullText:string;kind:'category'|'value'|'empty'|'overflow';count:number;x:number;y:number;width:number;height:number;fontSize:number;align:'left'|'center'|'right';color:string;fontWeight:number }
interface ChartLayout { width:number;height:number;backgroundColor:string;empty:boolean;compact:boolean;paths:readonly ChartPath[];rects:readonly ChartRect[];circles:readonly ChartCircle[];texts:readonly ChartText[];hiddenLabelCount:number }
interface ChartMutableLayout extends Omit<ChartLayout,'paths'|'rects'|'circles'|'texts'> {paths:ChartPath[];rects:ChartRect[];circles:ChartCircle[];texts:ChartText[]}
export interface OpenPencilChartConfig {
 chartType:'bar'|'line'|'area'|'pie'|'donut';values:readonly number[];labels:readonly string[];color:string;showValues:boolean;layout:ChartLayout
}`

export const CHART_PRESENTATION_SOURCE = `function chartCopy(language:string){
 const chinese=language.toLowerCase().startsWith('zh')
 return chinese?{types:{bar:'柱状图',line:'折线图',area:'面积图',pie:'饼图',donut:'环形图'},data:'图表数据',category:'类别',value:'数值',empty:'暂无非零数据',noData:'暂无数据',invalid:'图表数据不可用',points:'个数据点',hidden:'个标签因空间不足未显示。完整数据见数据表。',compact:'当前尺寸较小，请查看完整数据表。'}:
 {types:{bar:'Bar chart',line:'Line chart',area:'Area chart',pie:'Pie chart',donut:'Donut chart'},data:'Chart data',category:'Category',value:'Value',empty:'No non-zero values',noData:'No data',invalid:'Chart data unavailable',points:'data points',hidden:'labels are hidden to fit this size. Full data is available in the table.',compact:'This chart is compact. Consult the full data table.'}
}
function chartDescription(config:OpenPencilChartConfig,copy:ReturnType<typeof chartCopy>,invalid=false,emptyData=false){
 if(invalid)return copy.invalid
 if(emptyData)return copy.noData
 return [config.layout.empty?copy.empty:config.values.length+' '+copy.points,config.layout.hiddenLabelCount?config.layout.hiddenLabelCount+' '+copy.hidden:'',config.layout.compact?copy.compact:''].filter(Boolean).join('. ')
}
function chartTextAnchor(text:ChartText){return text.align==='left'?'start':text.align==='right'?'end':'middle'}
function chartTextX(text:ChartText){return text.x+(text.align==='left'?0:text.align==='right'?text.width:text.width/2)}
function chartTextValue(text:ChartText,copy:ReturnType<typeof chartCopy>,invalid=false,emptyData=false){return text.kind==='empty'?(invalid?copy.invalid:emptyData?copy.noData:copy.empty):text.text}
function observeChartLanguage(root:HTMLElement,update:(language:string)=>void){
 const read=()=>update(root.closest('[lang]')?.getAttribute('lang')??'en')
 const observer=typeof MutationObserver==='function'?new MutationObserver(read):undefined
 for(let parent:HTMLElement|null=root;parent;parent=parent.parentElement)observer?.observe(parent,{attributes:true,attributeFilter:['lang']})
 read();return ()=>observer?.disconnect()
}`

export const CHART_STYLE_SOURCE = `[data-openpencil-chart]{min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden}
[data-openpencil-chart] [data-chart-svg]{position:absolute;inset:0;width:100%;height:100%;display:block;overflow:hidden;font-family:Inter,system-ui,sans-serif}
[data-openpencil-chart] [data-chart-table],[data-openpencil-chart] [data-chart-status]{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
`
