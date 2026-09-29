import { CODE_BLOCK_LAYOUT } from '@open-pencil/core/plugins'

export const CODE_BLOCK_CONFIG_SOURCE = `export interface OpenPencilCodeBlockConfig {
  label:string;code:string;language:'plaintext'|'javascript'|'typescript'|'json'|'html'|'css'|'bash'|'python'|'rust'|'dart';
  theme:'light'|'dark';showLineNumbers:boolean;wrapLines:boolean;showCopyButton:boolean;
  fontSize:number;tabSize:number;backgroundColor:string;textColor:string;accentColor:string
}
function codeBlockConfigKey(c:OpenPencilCodeBlockConfig):string {
 return JSON.stringify([c.label,c.code,c.language,c.theme,c.showLineNumbers,c.wrapLines,c.showCopyButton,c.fontSize,c.tabSize,c.backgroundColor,c.textColor,c.accentColor])
}
function codeBlockLocale(host:HTMLElement|null):string {return host?.closest('[lang]')?.getAttribute('lang')||'en'}
function codeBlockMessages(language:string) {return language.toLowerCase().startsWith('zh')
 ?{copy:'复制',pending:'正在复制…',success:'已复制',error:'复制失败，请手动选择代码后复制。'}
 :{copy:'Copy',pending:'Copying…',success:'Copied',error:'Copy failed. Select the code and copy it manually.'}}
function codeBlockStyle(config:OpenPencilCodeBlockConfig) {
 const count=config.code.split(/\\r\\n|\\r|\\n/).length
 return {'--code-background':config.backgroundColor,'--code-text':config.textColor,'--code-accent':config.accentColor,
 '--code-border':config.accentColor+'55','--code-font':config.fontSize+'px','--code-tab-size':config.tabSize,
 '--code-gutter':Math.max(30,String(count).length*config.fontSize*.7+${CODE_BLOCK_LAYOUT.inset})+'px'}
}
`

const HOST = '[data-openpencil-code-block]'
export const CODE_BLOCK_STYLE_SOURCE = `${HOST}{box-sizing:border-box;display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;background:var(--code-background);color:var(--code-text);container-type:inline-size}
${HOST} [data-code-header]{box-sizing:border-box;display:flex;align-items:center;gap:8px;flex:none;height:${CODE_BLOCK_LAYOUT.headerHeight}px;padding:${CODE_BLOCK_LAYOUT.headerInset}px ${CODE_BLOCK_LAYOUT.inset}px;border-bottom:1px solid var(--code-border)}
${HOST} [data-code-meta]{display:flex;flex:1;min-width:0;flex-direction:column;gap:2px}
${HOST} [data-code-title]{font:600 ${CODE_BLOCK_LAYOUT.headerFontSize}px/18px system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
${HOST} [data-code-language]{font:${CODE_BLOCK_LAYOUT.languageFontSize}px/16px ui-monospace,monospace;color:var(--code-accent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
${HOST} [data-code-copy]{box-sizing:border-box;flex:none;width:${CODE_BLOCK_LAYOUT.copyWidth}px;height:${CODE_BLOCK_LAYOUT.actionHeight}px;padding:0 6px;border:1px solid var(--code-accent);border-radius:6px;background:transparent;color:var(--code-text);font:${CODE_BLOCK_LAYOUT.headerFontSize}px system-ui,sans-serif;cursor:pointer;touch-action:manipulation}
${HOST} [data-code-copy]:disabled{cursor:wait;opacity:.7}
${HOST} [data-code-copy]:focus-visible,${HOST} [data-code-scroll]:focus-visible{outline:2px solid var(--code-accent);outline-offset:-3px}
${HOST} [data-code-scroll]{box-sizing:border-box;flex:1;min-height:0;overflow:auto;padding:${CODE_BLOCK_LAYOUT.inset}px}
${HOST} pre,${HOST} code{margin:0;font:var(--code-font)/${CODE_BLOCK_LAYOUT.lineHeight} ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;tab-size:var(--code-tab-size);font-variant-ligatures:none}
${HOST} pre{min-width:100%;width:max-content}
${HOST}[data-code-wrap=true] pre{width:100%}
${HOST} code{display:block}
${HOST} [data-code-row]{display:grid;grid-template-columns:minmax(0,1fr);min-height:${CODE_BLOCK_LAYOUT.lineHeight}em}
${HOST}[data-code-numbers=true] [data-code-row]{grid-template-columns:var(--code-gutter) minmax(0,1fr)}
${HOST} [data-code-number]{box-sizing:border-box;padding-right:8px;text-align:end;color:var(--code-accent);user-select:none;white-space:nowrap}
${HOST} [data-code-text]{min-width:0;white-space:pre}
${HOST}[data-code-wrap=true] [data-code-text]{white-space:pre-wrap;overflow-wrap:anywhere}
${HOST} [data-code-status]{flex:none;margin:0;padding:4px ${CODE_BLOCK_LAYOUT.inset}px 8px;font:12px/18px system-ui,sans-serif;overflow-wrap:anywhere}
${HOST} [data-code-status]:empty{display:none}
@container(max-width:${CODE_BLOCK_LAYOUT.copyMinimumWidth - 1}px){${HOST} [data-code-copy]{display:none}}
`
