import { validate } from '@prisma/prisma-schema-wasm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { toDrizzle } from './drizzle'
import { toPrisma } from './prisma'
import type { PrismaProvider } from './prisma'
import { FIXTURES, parse } from './testing'
import { toTypeScript, toZod } from './typescript'

/* The generated code is checked by the real tools: Prisma's own schema
   validator, and the TypeScript compiler against drizzle-orm and zod. */

function prismaErrors(schema: string): string | null {
  try {
    validate(JSON.stringify({ prismaSchema: [['schema.prisma', schema]], noColor: true }))
    return null
  } catch (err) {
    const text = String(err)
    try {
      return (JSON.parse(text.replace(/^Error: /, '')) as { message: string }).message
    } catch {
      return text
    }
  }
}

describe('generated Prisma schemas pass prisma validate', () => {
  for (const f of FIXTURES) {
    const providers: PrismaProvider[] = f.mysql ? ['mysql'] : ['postgresql', 'mysql', 'sqlite']
    for (const provider of providers) {
      it(`${f.name} (${provider})`, () => {
        const schema = toPrisma(parse(f.dbml), { provider })
        expect(prismaErrors(schema), schema).toBeNull()
      })
    }
  }
})

/** Type-check virtual files that sit in the project, so imports resolve to node_modules. */
function typeErrors(files: Record<string, string>): string[] {
  // vitest runs from the project root, so imports in the virtual files resolve to its node_modules
  const root = ts.sys.getCurrentDirectory().replace(/\\/g, '/')
  const virtual = new Map(Object.entries(files).map(([name, text]) => [`${root}/__generated__/${name}`, text]))
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    types: [],
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  }
  const host = ts.createCompilerHost(options)
  const norm = (f: string) => f.replace(/\\/g, '/')
  const getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (name, lang, ...rest) => {
    const text = virtual.get(norm(name))
    return text != null ? ts.createSourceFile(name, text, lang) : getSourceFile(name, lang, ...rest)
  }
  const fileExists = host.fileExists.bind(host)
  host.fileExists = (name) => virtual.has(norm(name)) || fileExists(name)
  const readFile = host.readFile.bind(host)
  host.readFile = (name) => virtual.get(norm(name)) ?? readFile(name)
  const program = ts.createProgram([...virtual.keys()], options, host)
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file && virtual.has(norm(d.file.fileName)))
    .map((d) => {
      const { line } = d.file!.getLineAndCharacterOfPosition(d.start ?? 0)
      return `${d.file!.fileName.split('/').pop()}:${line + 1} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}\n  ${d.file!.text.split('\n')[line]}`
    })
}

describe('generated TypeScript compiles', () => {
  it('Drizzle (pg-core and mysql-core), Zod and plain types', { timeout: 120_000 }, () => {
    const files: Record<string, string> = {}
    FIXTURES.forEach((f, i) => {
      const model = parse(f.dbml)
      if (!f.mysql) files[`drizzle-pg-${i}.ts`] = toDrizzle(model, { dialect: 'postgres' })
      files[`drizzle-mysql-${i}.ts`] = toDrizzle(model, { dialect: 'mysql' })
      files[`zod-${i}.ts`] = toZod(model)
      files[`types-${i}.ts`] = toTypeScript(model)
    })
    expect(typeErrors(files)).toEqual([])
  })
})
