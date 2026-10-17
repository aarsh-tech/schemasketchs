import type { Faker } from '@faker-js/faker'
import { parseType, typeKind } from '@/lib/convert/shared'
import type { FieldModel, TableModel } from '@/lib/dbml/types'

/* A realistic value for a column, picked from its name, its table and its type. */

export type Value = string | number | boolean | null | { date: Date; kind: 'date' | 'datetime' | 'time' } | { bytes: string }

/** One person per row, so first_name, last_name and email agree with each other. */
export interface RowContext {
  person?: { first: string; last: string }
}

const words = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

const PEOPLE = /author|user|customer|client|person|people|employee|member|staff|student|teacher|contact|owner|player|patient|account|admin|writer|artist|driver|guest/
const ORGS = /compan|publisher|vendor|supplier|organi[sz]ation|brand|manufacturer|team|club|agency|store|shop|merchant|tenant/
const PRODUCTS = /product|item|book|course|plan|service|listing|article|movie|album|recipe/
const PLACES = /cit(y|ies)|town|countr|region|warehouse|location|venue|branch/

function person(f: Faker, ctx: RowContext) {
  ctx.person ??= { first: f.person.firstName(), last: f.person.lastName() }
  return ctx.person
}

export interface TypeInfo {
  base: string
  kind: ReturnType<typeof typeKind>
  length: number | null
  precision: number | null
  scale: number | null
  array: boolean
}

export function typeInfo(type: string): TypeInfo {
  const t = parseType(type)
  const nums = t.args.map(Number).filter((n) => Number.isFinite(n))
  const kind = typeKind(t.base)
  const isText = kind === 'string'
  return {
    base: t.base,
    kind,
    length: isText && nums.length ? nums[0] : t.base === 'char' ? (nums[0] ?? 1) : null,
    precision: kind === 'decimal' && nums.length ? nums[0] : null,
    scale: kind === 'decimal' ? (nums[1] ?? (nums.length ? 0 : 2)) : null,
    array: t.array,
  }
}

function numberIn(f: Faker, info: TypeInfo, min: number, max: number): number {
  if (info.kind === 'decimal' || info.kind === 'float') {
    const scale = info.scale ?? 2
    const limit = info.precision ? 10 ** (info.precision - scale) - 1 : max
    return f.number.float({ min: Math.min(min, limit), max: Math.min(max, limit), fractionDigits: scale })
  }
  const cap = info.base === 'smallint' ? 32767 : info.base === 'tinyint' ? 127 : max
  return f.number.int({ min: Math.min(min, cap), max: Math.min(max, cap) })
}

const fit = (s: string, info: TypeInfo) => (info.length && s.length > info.length ? s.slice(0, info.length) : s)

/** A value for a plain column (not a key the generator fills in itself). */
export function valueFor(f: Faker, table: TableModel, field: FieldModel, ctx: RowContext, enumValues: string[] | null): Value {
  if (enumValues?.length) return f.helpers.arrayElement(enumValues)
  const info = typeInfo(field.type)
  const w = words(field.name)
  const has = (...names: string[]) => names.some((n) => w.includes(n))
  const last = w[w.length - 1] ?? ''
  const tbl = table.name.toLowerCase()
  const text = (s: string): Value => (info.kind === 'string' || info.kind === 'unknown' ? fit(s, info) : s)

  if (info.array) return `{${f.lorem.words(2).split(' ').map((x) => `"${x}"`).join(',')}}`

  /* by kind first where the name can't change the meaning */
  if (info.kind === 'bool') return has('deleted', 'archived', 'banned', 'locked') ? f.datatype.boolean({ probability: 0.1 }) : f.datatype.boolean({ probability: 0.7 })
  if (info.kind === 'uuid') return f.string.uuid()
  if (info.kind === 'bytes') return { bytes: f.string.hexadecimal({ length: 16, prefix: '' }).toLowerCase() }
  if (info.kind === 'json') return JSON.stringify({ [f.lorem.word()]: f.lorem.word(), n: f.number.int(100) })
  if (info.kind === 'date' || info.kind === 'datetime' || info.kind === 'time') {
    const kind = info.kind
    if (has('birth', 'dob', 'birthday')) return { date: f.date.birthdate({ mode: 'age', min: 18, max: 80 }), kind }
    if (has('expires', 'expiry', 'due', 'until', 'ends', 'end', 'deadline')) return { date: f.date.soon({ days: 120 }), kind }
    return { date: f.date.past({ years: 2 }), kind }
  }

  /* numbers named for what they hold */
  if (info.kind === 'int' || info.kind === 'bigint' || info.kind === 'decimal' || info.kind === 'float') {
    if (has('price', 'amount', 'total', 'cost', 'balance', 'fee', 'subtotal', 'tax', 'salary', 'revenue', 'budget')) return numberIn(f, info, 1, 500)
    if (has('quantity', 'qty', 'count', 'stock', 'units', 'seats', 'pages')) return numberIn(f, info, 1, 20)
    if (has('rating', 'stars', 'score')) return numberIn(f, info, 1, 5)
    if (has('age')) return numberIn(f, info, 18, 90)
    if (has('year')) return numberIn(f, info, 1950, 2025)
    if (has('lat', 'latitude')) return Number(f.location.latitude())
    if (has('lng', 'lon', 'longitude')) return Number(f.location.longitude())
    if (has('percent', 'percentage', 'discount')) return numberIn(f, info, 0, 50)
    if (has('position', 'sort', 'order', 'rank', 'priority', 'level')) return numberIn(f, info, 1, 10)
    return numberIn(f, info, 1, 1000)
  }

  /* text named for what it holds */
  if (has('email', 'mail')) {
    const p = person(f, ctx)
    return text(f.internet.email({ firstName: p.first, lastName: p.last }).toLowerCase())
  }
  if (has('first', 'firstname', 'given', 'forename')) return text(person(f, ctx).first)
  if (has('last', 'lastname', 'surname', 'family')) return text(person(f, ctx).last)
  if (has('username', 'login', 'handle', 'nickname')) {
    const p = person(f, ctx)
    return text(f.internet.username({ firstName: p.first, lastName: p.last }).toLowerCase())
  }
  if (has('phone', 'mobile', 'tel', 'telephone', 'fax')) return text(f.phone.number({ style: 'international' }))
  if (has('isbn')) return text(f.commerce.isbn({ variant: 13, separator: '' }))
  if (has('sku', 'code', 'ref', 'reference') && !has('country', 'currency', 'zip', 'postal', 'post')) return text(f.string.alphanumeric({ length: 8, casing: 'upper' }))
  if (has('line', 'street', 'address', 'addr') && has('2')) return text(f.location.secondaryAddress())
  if (has('street', 'address', 'addr') || (has('line') && has('1'))) return text(f.location.streetAddress())
  if (has('city', 'town')) return text(f.location.city())
  if (has('state', 'province', 'county', 'region')) return text(f.location.state())
  if (has('country') && has('code')) return text(f.location.countryCode())
  if (has('country')) return text(f.location.country())
  if (has('postcode', 'zip', 'zipcode', 'postal')) return text(f.location.zipCode())
  if (has('currency')) return text(f.finance.currencyCode())
  if (has('ip')) return text(f.internet.ipv4())
  if (has('url', 'website', 'homepage', 'link', 'site')) return text(f.internet.url())
  if (has('avatar', 'image', 'photo', 'picture', 'logo', 'thumbnail', 'icon')) return text(f.image.url())
  if (has('slug')) return text(f.helpers.slugify(f.lorem.words(3)).toLowerCase())
  if (has('password', 'hash', 'digest', 'token', 'secret', 'salt')) return text(f.string.alphanumeric(40))
  if (has('color', 'colour')) return text(f.color.human())
  if (has('gender', 'sex')) return text(f.person.sex())
  if (has('language', 'locale', 'lang')) return text(f.helpers.arrayElement(['en', 'fr', 'de', 'es', 'ja', 'pt']))
  if (has('timezone', 'tz')) return text(f.location.timeZone())
  if (has('status', 'state')) return text(f.helpers.arrayElement(['active', 'pending', 'inactive']))
  if (has('type', 'kind', 'category', 'genre', 'role')) return text(f.helpers.arrayElement(['standard', 'premium', 'basic', 'other']))
  if (has('company', 'organization', 'organisation', 'employer')) return text(f.company.name())
  if (has('job', 'occupation', 'position') && has('title', 'name')) return text(f.person.jobTitle())
  if (has('title', 'headline', 'subject', 'heading')) {
    if (/book|novel/.test(tbl)) return text(f.book.title())
    if (PRODUCTS.test(tbl)) return text(f.commerce.productName())
    return text(f.lorem.sentence({ min: 3, max: 6 }).replace(/\.$/, ''))
  }
  if (has('description', 'bio', 'about', 'summary', 'body', 'content', 'text', 'comment', 'note', 'notes', 'message', 'details', 'review')) {
    return text(info.length && info.length < 60 ? f.lorem.words(3) : f.lorem.sentences(2))
  }
  if (has('name') || last === 'name' || last === 'label') {
    if (has('full', 'display', 'contact')) {
      const p = person(f, ctx)
      return text(`${p.first} ${p.last}`)
    }
    if (PEOPLE.test(tbl)) {
      const p = person(f, ctx)
      return text(`${p.first} ${p.last}`)
    }
    if (ORGS.test(tbl)) return text(f.company.name())
    if (PRODUCTS.test(tbl)) return text(/book/.test(tbl) ? f.book.title() : f.commerce.productName())
    if (PLACES.test(tbl)) return text(f.location.city())
    if (/categor|tag|genre|department/.test(tbl)) return text(f.commerce.department())
    return text(`${f.word.adjective()} ${f.word.noun()}`)
  }
  return text(info.length && info.length < 12 ? f.string.alpha({ length: Math.max(1, Math.min(info.length, 6)) }) : f.lorem.words(2))
}
