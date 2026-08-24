import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { namedQueries, runNamedQuery, runReadOnlyQuery } from '../storage/own-db.js'

const queryNames = Object.keys(namedQueries) as [keyof typeof namedQueries, ...(keyof typeof namedQueries)[]]

export const namedQueryTool = new DynamicStructuredTool({
  name: 'run_named_query',
  description: `Run one of the predefined, read-only SQL queries and return the rows as JSON. Available query names: ${queryNames.join(', ')}.`,
  schema: z.object({
    name: z.enum(queryNames).describe('Which predefined query to run'),
  }),
  func: async ({ name }) => JSON.stringify(await runNamedQuery(name)),
})

export const sqlQueryTool = new DynamicStructuredTool({
  name: 'run_sql_query',
  description:
    'Run a read-only SELECT query you write yourself against the work_coordinator database and return rows as JSON. ' +
    'Only SELECT is allowed (no INSERT/UPDATE/DELETE/DDL); a LIMIT 200 is added automatically if you omit one. ' +
    'Prefer run_named_query when one of its presets already answers the question.',
  schema: z.object({
    query: z.string().describe('A single read-only SELECT statement'),
  }),
  func: async ({ query }) => JSON.stringify(await runReadOnlyQuery(query)),
})
