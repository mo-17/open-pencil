import type { PagePathInfo } from '../react/route-paths'

export function buildGuardedReactRouterApp(
  infos: readonly PagePathInfo[],
  devMode: boolean,
  prototypeRuntime: boolean
): string {
  const start = infos[0]?.ir.applicationStart && infos[0].route !== '/' ? infos[0].route : undefined
  const imports = [
    ...(devMode ? ["import './__preview-bridge'"] : []),
    ...(prototypeRuntime ? ["import './__prototype-runtime'"] : []),
    `import { createBrowserRouter, RouterProvider${start ? ', Navigate' : ''} } from 'react-router-dom'`,
    "import { ApplicationGuardLayout, ApplicationGuardPage } from './components/_open-pencil-application-guards'",
    ...(infos.some((info) => info.ir.applicationStateRetention !== undefined)
      ? [
          "import { OpenPencilApplicationPage } from './components/_open-pencil-application-session'"
        ]
      : []),
    ...infos.map((info) => `import ${info.component} from './pages/${info.slug}'`)
  ].join('\n')
  const routes = [
    ...(start
      ? [`    { path: '/', element: <Navigate to=${JSON.stringify(start)} replace /> }`]
      : []),
    ...infos.map((info) => {
      const page = `<${info.component} />`
      const session =
        info.ir.applicationStateRetention === undefined
          ? page
          : `<OpenPencilApplicationPage pageId=${JSON.stringify(info.ir.pageId)} retention=${JSON.stringify(info.ir.applicationStateRetention)}>${page}</OpenPencilApplicationPage>`
      return `    { path: ${JSON.stringify(info.route)}, element: <ApplicationGuardPage pageId=${JSON.stringify(info.ir.pageId)}>${session}</ApplicationGuardPage> }`
    })
  ].join(',\n')
  return `${imports}

const router = typeof window === 'undefined' ? undefined : createBrowserRouter([
  { element: <ApplicationGuardLayout />, children: [
${routes}
  ] }
])

export default function App() {
  return router ? <RouterProvider router={router} /> : <section>Routing unavailable.</section>
}
`
}
