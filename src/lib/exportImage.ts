import { getNodesBounds, getViewportForBounds } from '@xyflow/react'
import type { Node } from '@xyflow/react'
import { toJpeg, toPng, toSvg } from 'html-to-image'

const PADDING = 48

/**
 * Renders the whole diagram (not just what's on screen) to an image data URL.
 */
export async function renderDiagram(nodes: Node[], format: 'png' | 'svg' | 'jpeg', opts: { light?: boolean } = {}): Promise<string> {
  const viewport = document.querySelector<HTMLElement>('.schemasketch-flow .react-flow__viewport')
  if (!viewport || nodes.length === 0) throw new Error('There is nothing on the canvas to export yet.')
  // print in the light theme whatever the app shows: the colour tokens are redefined for this subtree only
  const previousTheme = viewport.dataset.theme
  if (opts.light) viewport.dataset.theme = 'light'
  try {
    return await render(viewport, nodes, format)
  } finally {
    if (opts.light) {
      if (previousTheme) viewport.dataset.theme = previousTheme
      else delete viewport.dataset.theme
    }
  }
}

async function render(viewport: HTMLElement, nodes: Node[], format: 'png' | 'svg' | 'jpeg'): Promise<string> {

  const bounds = getNodesBounds(nodes)
  const width = Math.ceil(bounds.width + PADDING * 2)
  const height = Math.ceil(bounds.height + PADDING * 2)
  const { x, y, zoom } = getViewportForBounds(bounds, width, height, 1, 1, 0)

  const background = getComputedStyle(viewport).getPropertyValue('--c-canvas').trim() || '#ffffff'
  const options = {
    backgroundColor: background,
    width,
    height,
    pixelRatio: format === 'svg' ? 1 : Math.min(3, Math.max(1.5, 4000 / Math.max(width, height))),
    quality: 0.92,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${x}px, ${y}px) scale(${zoom})`,
    },
    // edge hover targets are transparent anyway; skip handles, and app-only badges such as lint warnings
    filter: (el: HTMLElement) => !el.classList?.contains('react-flow__handle') && !el.classList?.contains('ss-export-hide'),
  }
  if (format === 'jpeg') return toJpeg(viewport, options)
  return format === 'png' ? toPng(viewport, options) : toSvg(viewport, options)
}
