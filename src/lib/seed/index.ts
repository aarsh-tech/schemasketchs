/* Entry point for the seed data generator. The app loads it with a dynamic
   import(), so faker never lands in the main bundle. */
export { MAX_ROWS, generateSeed, insertOrder } from './generate'
export type { SeedDialect, SeedOptions, SeedResult } from './generate'
