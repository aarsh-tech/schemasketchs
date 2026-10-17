import { create } from 'zustand'
import type { ProjectFile } from '@/lib/files'

export type DialogState =
  | { type: 'import-sql'; text?: string; fileName?: string }
  | { type: 'export-code' }
  | { type: 'help' }
  | { type: 'delete-project'; projectId: string }
  | { type: 'shared-link'; file: ProjectFile }
  | { type: 'share'; url: string }
  | { type: 'history' }
  | null

export const useDialogs = create<{ dialog: DialogState; open: (d: DialogState) => void; close: () => void }>((set) => ({
  dialog: null,
  open: (dialog) => set({ dialog }),
  close: () => set({ dialog: null }),
}))
