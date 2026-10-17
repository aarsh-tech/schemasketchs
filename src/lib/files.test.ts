import { describe, expect, it } from 'vitest'
import { SAMPLE_DBML } from '@/lib/sample'
import { guessKind, guessTextKind } from './files'

describe('guessKind', () => {
  it('goes by the extension first', () => {
    expect(guessKind('schema.prisma', '')).toBe('prisma')
    expect(guessKind('db/schema.ts', '')).toBe('drizzle')
    expect(guessKind('schema.rb', '')).toBe('sql')
    expect(guessKind('dump.SQL', '')).toBe('sql')
    expect(guessKind('shop.schemasketch.json', '')).toBe('project')
    expect(guessKind('shop.dbml', 'model User {')).toBe('dbml')
  })

  it('reads the text when the extension says nothing', () => {
    expect(guessKind('schema.txt', 'generator client {\n  provider = "prisma-client"\n}')).toBe('prisma')
    expect(guessKind('notes', "import { pgTable } from 'drizzle-orm/pg-core'")).toBe('drizzle')
    expect(guessKind('notes', 'CREATE TABLE users (id int);')).toBe('sql')
    expect(guessKind('notes', SAMPLE_DBML)).toBe('dbml')
  })
})

describe('guessTextKind', () => {
  it('recognises each format and nothing else', () => {
    expect(guessTextKind('datasource db {\n  provider = "mysql"\n}')).toBe('prisma')
    expect(guessTextKind("export const users = mysqlTable('users', {})")).toBe('drizzle')
    expect(guessTextKind('ActiveRecord::Schema[7.1].define(version: 1) do')).toBe('sql')
    expect(guessTextKind(SAMPLE_DBML)).toBeNull()
    expect(guessTextKind('Table model { id int }')).toBeNull()
  })
})
