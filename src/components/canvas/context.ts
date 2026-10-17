import { createContext } from 'react'
import type { RefModel } from '@/lib/dbml/types'

/** Set by the editor's canvas; without it (the read-only embed) relationships can't be deleted. */
export const DeleteRelationshipContext = createContext<((ref: RefModel) => void) | null>(null)
