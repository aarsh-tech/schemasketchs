import { getNodesBounds, getViewportForBounds } from '@xyflow/react'
import type { Node } from '@xyflow/react'
import { toPng, toSvg } from 'html-to-image'

const PADDING = 48

/**
 * Renders the whole diagram (not just what's on screen) to an image data URL.
 */
export async function renderDiagram(nodes: Node[], format: 'png' | 'svg'): Promise<string> {
  const viewport = document.querySelector<HTMLElement>('.schemasketch-flow .react-flow__viewport')
  if (!viewport || nodes.length === 0) throw new Error('There is nothing on the canvas to export yet.')

  const bounds = getNodesBounds(nodes)
  const width = Math.ceil(bounds.width + PADDING * 2)
  const height = Math.ceil(bounds.height + PADDING * 2)
  const { x, y, zoom } = getViewportForBounds(bounds, width, height, 1, 1, 0)

  const background = getComputedStyle(document.documentElement).getPropertyValue('--c-canvas').trim() || '#ffffff'
  const options = {
    backgroundColor: background,
    width,
    height,
    pixelRatio: format === 'png' ? Math.min(3, Math.max(1.5, 4000 / Math.max(width, height))) : 1,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${x}px, ${y}px) scale(${zoom})`,
    },
    // edge hover targets are transparent anyway; skip handles and labels
    filter: (el: HTMLElement) => !el.classList?.contains('react-flow__handle'),
  }
  return format === 'png' ? toPng(viewport, options) : toSvg(viewport, options)
}
