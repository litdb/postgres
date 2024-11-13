import { describe, it, expect } from 'bun:test'
import postgres from 'postgres'

  
describe('pg tests', () => {
    it('export 1', () => {
      expect(1).toBe(1)
    })
  
    it('export 2', () => {
      expect(2).toBe(2)
    })

    it ('Should connect to postgres', async () => {
        const sql = postgres({ hostname:'localhost',database:'test',user:'test',password:'test' })
        const stmt = sql.unsafe(`SELECT 1 AS c1, $1 AS c2`, ['foo'])
        const r = await stmt
        console.log(r)
        console.log(r[0], r[2])
    
        const arr = await sql.unsafe(`SELECT 1 AS c1, $1 AS c2`, ['foo']).values()
        console.log('arrays', arr[0], arr[1])
      })
  })
  