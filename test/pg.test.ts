import { describe, it, expect } from 'bun:test'
import postgres from 'postgres'
import { sql } from './db'
  
describe('native postgres tests', () => {

  it ('Should connect to postgres', async () => {
      const $ = postgres({ hostname:'localhost',database:'test',user:'test',password:'test' })
      const stmt = $.unsafe(`SELECT 1 AS c1, $1 AS c2`, ['foo'])
      const r = await stmt
      console.log(r)
      console.log(r[0], r[2])
  
      let arr = await $.unsafe(`SELECT 1 AS c1, $1 AS c2`, ['foo']).values()
      expect(arr[0]).toEqual([1,'foo'])

      arr = await sql.unsafe(`SELECT 1 AS c1, $1 AS c2`, ['foo']).values()
      expect(arr[0]).toEqual([1,'foo'])
    })

})
