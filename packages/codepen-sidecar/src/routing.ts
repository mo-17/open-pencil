import type { CodePenSidecarTarget } from './protocol'

export type CodePenRoutingStatus = 'changed' | 'none' | 'unavailable'

function occurrences(source: string, token: string): number {
  return source.split(token).length - 1
}

export function applyCodePenRoutingFallback(
  source: string,
  target: CodePenSidecarTarget
): { source: string; status: CodePenRoutingStatus } {
  if (target === 'react') {
    const importToken = "import { BrowserRouter, Route, Routes } from 'react-router-dom'"
    if (!source.includes(importToken)) {
      return { source, status: source.includes('BrowserRouter') ? 'unavailable' : 'none' }
    }
    if (
      occurrences(source, importToken) !== 1 ||
      occurrences(source, '<BrowserRouter>') !== 1 ||
      occurrences(source, '</BrowserRouter>') !== 1
    ) {
      return { source, status: 'unavailable' }
    }
    return {
      source: source
        .replace(importToken, "import { HashRouter, Route, Routes } from 'react-router-dom'")
        .replace('<BrowserRouter>', '<HashRouter>')
        .replace('</BrowserRouter>', '</HashRouter>'),
      status: 'changed'
    }
  }

  const importToken = "import { createRouter, createWebHistory } from 'vue-router'"
  const callToken = 'history: createWebHistory(import.meta.env.BASE_URL),'
  if (!source.includes(importToken)) {
    return { source, status: source.includes('createWebHistory') ? 'unavailable' : 'none' }
  }
  if (occurrences(source, importToken) !== 1 || occurrences(source, callToken) !== 1) {
    return { source, status: 'unavailable' }
  }
  return {
    source: source
      .replace(importToken, "import { createRouter, createWebHashHistory } from 'vue-router'")
      .replace(callToken, 'history: createWebHashHistory(import.meta.env.BASE_URL),'),
    status: 'changed'
  }
}
