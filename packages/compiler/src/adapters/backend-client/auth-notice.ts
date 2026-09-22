/** Session notices stay inside the generated app; neither tokens nor notices enter editor state. */
export const AUTH_NOTICE_SOURCE = String.raw`
let displayedAuthenticationNotice: ReturnType<typeof getSession>['notice'] = null
function updateAuthenticationNotice(notice: ReturnType<typeof getSession>['notice']): void {
  if (notice === displayedAuthenticationNotice) return
  displayedAuthenticationNotice = notice
  initializationAlert?.remove()
  initializationAlert = undefined
  if (!notice) return
  const zh = (document.documentElement.lang || navigator.language).toLowerCase().startsWith('zh')
  const copy = {
    'signing-in': ['Complete sign-in in your browser, then return here.', '请在系统浏览器完成登录，再返回此处。'],
    expired: ['Your session expired. Sign in again to return to your page. Failed changes will not be submitted again.', '登录已过期。重新登录后可返回原页面；失败的写入不会自动重新提交。'],
    cancelled: ['Sign-in was cancelled. You can try again when ready.', '登录已取消，可在准备好后重试。'],
    timeout: ['Sign-in timed out. Start a new sign-in attempt.', '登录已超时，请重新开始登录。'],
    'browser-unavailable': ['The system browser could not be opened. Check your default browser and try again.', '无法打开系统浏览器，请检查默认浏览器后重试。'],
    failed: ['Sign-in could not be completed. Check the identity service and try again.', '登录未完成，请检查身份服务后重试。'],
  }
  initializationAlert = document.createElement('section')
  initializationAlert.setAttribute('role', notice === 'signing-in' ? 'status' : 'alert')
  initializationAlert.setAttribute('data-openpencil-auth-error', notice)
  initializationAlert.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;margin:0;padding:12px;background:#fff3f3;color:#7f1d1d;font:14px sans-serif;display:flex;align-items:center;gap:12px;flex-wrap:wrap'
  const label = document.createElement('span')
  label.textContent = copy[notice][zh ? 1 : 0]
  const button = document.createElement('button')
  button.type = 'button'
  button.style.cssText = 'min-height:36px;padding:6px 12px;border:1px solid currentColor;border-radius:6px;background:white;color:inherit;cursor:pointer'
  button.textContent = notice === 'signing-in' ? (zh ? '取消登录' : 'Cancel sign-in') : (zh ? '重新登录' : 'Sign in again')
  button.onclick = () => {
    if (notice === 'signing-in') cancelSignIn()
    else { button.disabled = true; void signIn().catch(() => undefined) }
  }
  initializationAlert.append(label, button)
  document.body.prepend(initializationAlert)
}
`
