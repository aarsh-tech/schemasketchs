import { describe, expect, it } from 'vitest'
import { SAMPLE_DBML } from '@/lib/sample'
import { parse } from './testing'
import { toTypeScript, toZod } from './typescript'

describe('TypeScript export', () => {
  it('writes one interface per table with nullable columns as T | null', () => {
    const out = toTypeScript(parse(SAMPLE_DBML))
    expect(out).toContain("export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'cancelled'")
    expect(out).toContain(`/** One row per registered buyer */
export interface Customers {
  id: number
  email: string
  full_name: string
  created_at: Date | null
}`)
    expect(out).toContain('  status: OrderStatus | null')
    expect(out).toContain('  unit_price: number\n')
    // composite primary key columns are never null
    expect(out).toMatch(/interface OrderItems \{\n {2}order_id: number\n {2}book_id: number\n/)
  })

  it('quotes keys and keeps names unique', () => {
    const out = toTypeScript(parse('Table "user list" {\n  "first name" text\n  tags text[]\n}\nTable user_list {\n  id uuid\n  meta jsonb [not null]\n}'))
    expect(out).toContain('export interface UserList {\n  "first name": string | null\n  tags: string[] | null\n}')
    expect(out).toContain('export interface UserList2 {\n  id: string | null\n  meta: unknown\n}')
  })
})

describe('Zod export', () => {
  it('writes a schema and an inferred type per table', () => {
    const out = toZod(parse(SAMPLE_DBML))
    expect(out).toContain("import * as z from 'zod'")
    expect(out).toContain("export const orderStatusSchema = z.enum(['pending', 'paid', 'shipped', 'cancelled'])")
    expect(out).toContain(`export const customersSchema = z.object({
  id: z.int(),
  email: z.string().max(255),
  full_name: z.string().max(120),
  created_at: z.date().nullable(),
})
export type Customers = z.infer<typeof customersSchema>`)
    expect(out).toContain('  status: orderStatusSchema.nullable(),')
  })
})
