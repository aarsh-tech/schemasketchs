import { create } from 'zustand'
import type { CodeFormat } from '@/lib/actions'
import type { ProjectFile } from '@/lib/files'

export type ImportFormat = 'sql' | 'prisma' | 'drizzle' | 'database'

export type DialogState =
  | { type: 'import'; format?: ImportFormat; text?: string; fileName?: string }
  | { type: 'export-code'; format?: CodeFormat }
  | { type: 'help' }
  | { type: 'delete-project'; projectId: string }
  | { type: 'shared-link'; file: ProjectFile }
  | { type: 'share'; url: string }
  | { type: 'history' }
  /** sides are 'current', 'pasted' or 'v:<version id>' */
  | { type: 'migration'; from?: string; to?: string }
  /** viewId: edit that view; otherwise make a new one starting with tableIds */
  | { type: 'view'; viewId?: string; tableIds?: string[] }
  /** the command palette; mode 'focus' asks which table to focus on */
  | { type: 'palette'; mode?: 'focus' }
  | { type: 'live' }
  /** someone opened a live session link */
  | { type: 'live-join'; room: string; key: string; signaling: string[] }
  | null

export const useDialogs = create<{ dialog: DialogState; open: (d: DialogState) => void; close: () => void }>((set) => ({
  dialog: null,
  open: (dialog) => set({ dialog }),
  close: () => set({ dialog: null }),
}))
