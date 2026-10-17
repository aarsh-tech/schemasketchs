import { ReactFlowProvider } from '@xyflow/react'
import { Toaster } from 'sonner'
import { Dialogs } from '@/components/dialogs/Dialogs'
import { TopBar } from '@/components/TopBar'
import { Workspace } from '@/components/Workspace'
import { useFileDrop, useIncomingShare, useShortcuts } from '@/hooks/useAppEvents'
import { useSchemaSync } from '@/hooks/useSchemaSync'
import { useApplyTheme } from '@/hooks/useTheme'
import { useVersionHistory } from '@/hooks/useVersionHistory'

export default function App() {
  const theme = useApplyTheme()
  useSchemaSync()
  useVersionHistory()
  useShortcuts()
  useIncomingShare()
  const dragging = useFileDrop()

  return (
    <ReactFlowProvider>
      <div className="flex h-full flex-col">
        <TopBar />
        <Workspace />
      </div>
      <Dialogs />
      {dragging ? (
        <div className="pointer-events-none fixed inset-3 z-[70] flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-accent-soft/80 backdrop-blur-sm">
          <p className="text-[15px] font-semibold text-accent">Drop a .dbml, .sql, .prisma, Drizzle .ts or project .json file to open it</p>
        </div>
      ) : null}
      <Toaster
        theme={theme}
        position="top-center"
        offset={60}
        toastOptions={{
          style: {
            background: 'var(--c-raised)',
            color: 'var(--c-ink)',
            border: '1px solid var(--c-line)',
            fontFamily: 'var(--font-sans)',
          },
        }}
      />
    </ReactFlowProvider>
  )
}
