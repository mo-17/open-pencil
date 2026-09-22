import type {
  ManagedPreviewDiagnostic,
  ManagedPreviewPhase
} from '@open-pencil/compiler/managed-preview'

const en = {
  title: 'This computer',
  check: 'Check environment',
  retry: 'Check again',
  checking: 'Checking this computer…',
  details: 'Copy diagnostic report',
  boundary:
    'Read-only checks. Passing discovery and JWKS checks does not verify sign-in, account isolation or production readiness. Unavailable database checks need an existing initialized preview; no service is started or migration applied.',
  passed: 'Passed',
  failed: 'Needs attention',
  unavailable: 'Not checked',
  tls: 'Certificate verification failed',
  missing: 'File or command missing',
  'preview-configuration': [
    'Document and provider',
    'Check the current document authentication and enabled NestJS provider, then try again.'
  ],
  'ca-file': [
    'CA certificate',
    'Select the public CA file again if it moved or expired; the path belongs only to this computer.'
  ],
  'node-runtime': [
    'Node.js runtime',
    'Install Node.js 22.12 or later and make Node and Bun available in the desktop launch PATH. Restart the app afterwards.'
  ],
  'npm-runtime': ['npm runtime', 'Make npm available in the desktop launch PATH.'],
  'docker-runtime': ['Docker service', 'Install or start Docker yourself, then check again.'],
  'api-port': [
    'API port',
    'An existing process may use this port. Inspect it yourself; this check does not stop processes. Running previews skip this check.'
  ],
  'preview-port': [
    'Preview port',
    'An existing process may use this port. Close its preview if appropriate, then retry. Running previews skip this check.'
  ],
  database: [
    'Database and runtime role',
    'Check the dedicated database service, configured port and preserved credentials. A stopped database is not started by this check.'
  ],
  migration: [
    'Applied schema',
    'Check the existing migration receipt. Review schema changes explicitly; never reset an existing database to repair this result.'
  ],
  'oidc-discovery': [
    'Identity discovery',
    'Start your identity service and check its issuer and S256 PKCE configuration. For TLS errors, reselect the correct trusted CA.'
  ],
  jwks: [
    'Public signing keys',
    'Check the HTTPS signing-key endpoint and its hostname certificate. Reselect the trusted CA if needed; TLS verification stays enabled.'
  ]
}
const zh: typeof en = {
  title: '本机环境',
  check: '检测环境',
  retry: '重新检测',
  checking: '正在检测本机环境…',
  details: '复制诊断报告',
  boundary:
    '检测只读。Discovery 和 JWKS 通过不代表真实登录、账户隔离或生产可用。数据库未检测表示尚无已初始化的预览环境；检测不会启动服务或执行迁移。',
  passed: '通过',
  failed: '需要处理',
  unavailable: '未检测',
  tls: '证书验证失败',
  missing: '文件或命令不存在',
  'preview-configuration': [
    '文档与后端配置',
    '请检查当前文档登录配置，并启用 NestJS 后端插件，然后重试。'
  ],
  'ca-file': ['CA 证书文件', '证书文件移动或过期时，请重新选择公开 CA 文件；路径只属于本机。'],
  'node-runtime': [
    'Node.js 运行环境',
    '请自行安装 Node.js 22.12 或更新版本，确保桌面启动 PATH 能找到 Node 和 Bun，然后重启应用。'
  ],
  'npm-runtime': ['npm 运行环境', '请确保桌面应用启动时的 PATH 能找到 npm。'],
  'docker-runtime': ['Docker 服务', '请自行安装或启动 Docker，然后重新检测。'],
  'api-port': [
    'API 端口',
    '可能有其他进程占用端口，请自行检查；检测不会停止进程。预览运行时不重复探测端口。'
  ],
  'preview-port': [
    '预览端口',
    '可能有其他进程占用端口，按需关闭对应预览后重试。预览运行时不重复探测端口。'
  ],
  database: [
    '数据库与运行角色',
    '请检查独立数据库服务、配置端口及保留的凭据。检测不会启动已停止的数据库。'
  ],
  migration: [
    '已应用的数据库结构',
    '请检查现有迁移回执，并明确审核结构变更；不要通过重置已有数据库修复此项。'
  ],
  'oidc-discovery': [
    '身份服务 Discovery',
    '请启动身份服务，检查 Issuer 和 S256 PKCE 配置。证书错误时重新选择正确的受信任 CA。'
  ],
  jwks: [
    '公开签名密钥 JWKS',
    '请检查 HTTPS 密钥地址、主机名证书，必要时重新选择受信任 CA；TLS 校验始终开启。'
  ]
}
export function diagnosticCopy(locale: string) {
  return locale === 'zh-CN' ? zh : en
}
export function diagnosticReport(
  items: readonly ManagedPreviewDiagnostic[],
  time: number | null
): string {
  return JSON.stringify(
    {
      version: 1,
      checkedAt: time === null ? null : new Date(time).toISOString(),
      checks: items.map(({ code, status }) => ({ code, status }))
    },
    null,
    2
  )
}
export function stageLabel(
  stage: ManagedPreviewPhase | 'capturing' | 'diagnosing' | 'connecting' | null,
  locale: string
): string {
  const labels = {
    capturing: ['Reading and compiling the current document…', '正在读取并编译当前文档…'],
    diagnosing: ['Checking this computer…', '正在检测本机环境…'],
    installing: ['Installing dependencies…', '正在安装依赖…'],
    building: ['Building the backend…', '正在构建后端…'],
    migrating: ['Applying the reviewed database change…', '正在应用已审核的数据库变更…'],
    starting: ['Starting and checking the backend…', '正在启动并检查后端…'],
    connecting: ['Connecting the built-in preview…', '正在连接内置预览…']
  }
  return stage && stage in labels
    ? labels[stage as keyof typeof labels][locale === 'zh-CN' ? 1 : 0]
    : ''
}
