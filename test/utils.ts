import { SqlBuilder } from 'litdb'

export function str(q:SqlBuilder|string) {
    if (typeof q == 'string') 
        return q.replaceAll(/\n/g,' ').replaceAll(/\s+/g,' ').trim()
    const { sql } = q.build()
    return sql.replaceAll(/\n/g,' ').replaceAll(/\s+/g,' ').trim()
}
