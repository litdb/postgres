import postgres, { Options } from "postgres"
import type { 
    Driver, Connection, SyncConnection, DbBinding, Statement, Fragment, SyncStatement, Dialect,
    Changes, ColumnType, Constructor, ClassInstance, ReflectMeta, InsertOptions, UpdateOptions,
    DeleteOptions, ClassParam, SqlBuilder, IntoFragment,
} from "litdb"
import { 
    Sql, DbConnection, NamingStrategy, SyncDbConnection, DialectTypes, PostgreSqlDialect, DefaultStrategy, 
    Schema, IS, Meta, PostgreSqlSchema,
} from "litdb"

type DriverStatementQuery = {
    orig?:{ sql:string, params:Record<string,any> }
    sql:string
    values:any[]
    paramNames?:string[]    
}

export function convertNamedParams(sql:string, params:Record<string,any>): DriverStatementQuery {
    // Find all $paramName patterns
    const paramNames:string[] = []
    const toSql = sql.replace(/\$(\w+)/g, (_, name) => {
      paramNames.push(name)
      return `$${paramNames.length}`
    })
    
    // Create values array in the correct order
    const values = paramNames.map(name => {
      // if no params are provided treat as empty parameterized statement
      if (params.length && !(name in params)) {
        console.log('convertNamedParams ERROR', name, params, sql)
        throw new Error(`Missing parameter: ${name}`)
      }
      return params[name]
    })
    
    return {
      orig: { sql, params },
      sql: toSql,
      values,
      paramNames,
    }
}
  
class DriverStatement<RetType, ParamsType extends DbBinding[]> {
    constructor(public connection:PostgresConnection, public query:DriverStatementQuery) {}

    static forPositionalParams<RetType, ParamsType extends DbBinding[]>(connection:PostgresConnection, sql:string, params:any[]) {
        if (!IS.arr(params)) throw new Error('Expected array, but was: ' + typeof params)
        return new DriverStatement<RetType,ParamsType>(connection, { sql, values:params })
    }

    static forNamedParams<RetType, ParamsType extends DbBinding[]>(connection:PostgresConnection, sql:string, params:Record<string,any>) {
        if (!IS.rec(params)) throw new Error('Expected Record<string,any>, but was: ' + typeof params)
        const query = convertNamedParams(sql, params)
        return new DriverStatement<RetType,ParamsType>(connection, query)
    }

    params(params:DbBinding):any[]|undefined {
        // console.log('params', this.query.paramNames, params, typeof params, IS.arr(params))
        if (this.query.paramNames?.length && IS.rec(params)) {
            const values:any[] = []
            for (const key of this.query.paramNames) {
                values.push((params as any)[key] ?? null)
            }
            // console.log('returning values', values, params, this.query.paramNames)
            return values
        } else if (IS.arr(params)) {
            return params
        } else if (!this.query.values?.length) {
            return undefined
        } else if (this.query.values.length == 1) {
            return params 
                ? IS.arr(params) 
                    ? params 
                    : [params] 
                : undefined
        } else throw new Error(`Invalid params (${typeof params}) for query: ${this.query.sql}`)
    }

    unsafe<T extends any[]>(sql: string, paramValues?: any[] | undefined) {
        // console.log('unsafe', sql, paramValues)
        return this.connection.native.unsafe<T>(sql, paramValues)
    }

    async all(...params: ParamsType) {
        return this.unsafe(this.query.sql, this.params(params[0]))
    }

    async get(...params: ParamsType) {
        const ret =  await this.unsafe(this.query.sql, this.params(params[0]))
        return ret[0]
    }
    
    async arrays(...params: ParamsType) {
        const ret = await this.unsafe(this.query.sql, this.params(params[0])).values()
        // console.log('arrays', ret)
        return ret
    }
    
    async array(...params: ParamsType) {
        return (await this.unsafe(this.query.sql, this.params(params[0])).values())[0]
    }

    async exec(...params: ParamsType){
        const ret = await this.unsafe(this.query.sql, this.params(params[0])).values()
        const lastInsertRowid = ret[0] && ret[0][0] || 0
        // console.log('exec', lastInsertRowid, ret)
        return { changes: ret.count || 0, lastInsertRowid }
    }

    async run(...params: ParamsType) {
        await this.unsafe(this.query.sql, this.params(params[0]))
    }
}

const NotImplemented = () => new Error("Method not implemented.")

/**
 * Create a bun:sqlite SqliteDriver with the specified connection options
 */
export function connect<T extends Record<string,any>>(connection:ReturnType<typeof postgres>|string|Options<T>, options?:Options<T>) {
    if (!IS.fn(connection)) {
        const opt = (IS.obj(options) 
            ? options
            : IS.obj(connection) 
                ? connection
                : {}) as postgres.Options<T>
        if (!opt.onnotice) opt.onnotice = () => {}
        connection = IS.str(connection) 
            ? postgres(connection, opt)
            : postgres(opt)
    }
    return new PostgresConnection(connection, new Postgres())
}

export class PostgresStatement<RetType, ParamsType extends DbBinding[]>
    implements Statement<RetType, ParamsType>, SyncStatement<RetType, ParamsType>
{
    native: DriverStatement<RetType, ParamsType>
    _as?:RetType

    constructor(statement: DriverStatement<RetType, ParamsType>) {
        this.native = statement
    }

    result(o:any) {
        return o == null
            ? null
            : this._as && IS.obj(o) 
                ? new (this._as as Constructor<any>)(o) 
                : o
    }

    as<T extends Constructor<any>>(t:T) {
        const clone = new PostgresStatement<T,ParamsType>(this.native)
        clone._as = t
        return clone
    }

    async all(...params: ParamsType): Promise<RetType[]> {
        return (await this.native.all(...params)).map((x:any) => this.result(x))
    }

    async one(...params: ParamsType): Promise<RetType | null> {
        return this.result(await this.native.get(...params))
    }

    async column<ReturnValue>(...params: ParamsType): Promise<ReturnValue[]> {
        return (await this.native.arrays(...params)).map((row:any) => row[0] as ReturnValue)
    }

    async value<ReturnValue>(...params: ParamsType): Promise<ReturnValue | null> {
        return (await this.native.arrays(...params)).map((row:any) => row[0] as ReturnValue)?.[0] ?? null
    }

    async arrays(...params: ParamsType): Promise<any[][]> {
        return await this.native.arrays(...params)
    }
    async array(...params: ParamsType): Promise<any[] | null> {
        return  await this.native.array(...params)
    }

    async exec(...params: ParamsType): Promise<Changes> {
        //console.log('params',params)
        return await this.native.exec(...params)
    }

    async run(...params: ParamsType): Promise<void> {
        await this.native.run(...params)
    }

    allSync(...params: ParamsType): RetType[] { throw NotImplemented() }
    oneSync(...params: ParamsType): RetType | null { throw NotImplemented() }
    columnSync<ReturnValue>(...params: ParamsType): ReturnValue[] { throw NotImplemented() }
    valueSync<ReturnValue>(...params: ParamsType): ReturnValue | null { throw NotImplemented() }
    arraysSync(...params: ParamsType): any[][] { throw NotImplemented() }
    arraySync(...params: ParamsType): any[] | null { throw NotImplemented() }
    execSync(...params: ParamsType): Changes { throw NotImplemented() }
    runSync(...params: ParamsType):void { throw NotImplemented() }
}

export class PostgreSqlTypes implements DialectTypes {
    // use as-is
    native:ColumnType[] = [
        "INTEGER", "SMALLINT", "BIGINT", // INTEGER
        "REAL", "DOUBLE", "FLOAT", "DECIMAL",  // REAL
        "NUMERIC", "DECIMAL", "MONEY", //NUMERIC 
        "BOOLEAN", 
        "DATE", 
        "TIME", "TIMEZ", "TIMESTAMP", "TIMESTAMPZ", "INTERVAL",
        "UUID", "JSON", "JSONB", "XML", 
        "BLOB", "BYTES", "BIT",
    ]
    // use these types instead
    map: Record<string,ColumnType[]> = {
        "TIMESTAMPTZ": ["DATETIME"],
    }
}

export class Postgres implements Driver
{
    name: string
    dialect:Dialect
    schema:Schema
    $:ReturnType<typeof Sql.create>
    strategy:NamingStrategy = new DefaultStrategy()

    constructor() {
        this.dialect = new PostgreSqlDialect()
        this.$ = this.dialect.$
        this.name = this.constructor.name
        this.schema = this.$.schema = new PostgreSqlSchema(this, this.$, new PostgreSqlTypes())
    }
}

export class PostgresConnection implements Connection, SyncConnection {
    $:ReturnType<typeof Sql.create>
    async: DbConnection
    sync: SyncDbConnection
    schema: Schema
    dialect: Dialect

    constructor(public native:ReturnType<typeof postgres>, public driver:Driver & {
        $:ReturnType<typeof Sql.create>
    }) {
        this.$ = driver.$
        this.schema = this.$.schema = driver.schema
        this.dialect = driver.dialect
        this.async = new PostgresDbConnection(this)
        this.sync = new SyncDbConnection(this)
    }

    prepare<RetType, ParamsType extends DbBinding[]>(sql:TemplateStringsArray|string, ...params: DbBinding[])
        : Statement<RetType, ParamsType> {
        if (IS.tpl(sql)) {
            let sb = ''
            for (let i = 0; i < sql.length; i++) {
                sb += sql[i]
                if (i < params.length) {
                    sb += `$${i+1}`
                }
            }
            return new PostgresStatement(DriverStatement.forPositionalParams<RetType,ParamsType>(this, sb, params))
        } else {
            return new PostgresStatement(DriverStatement.forNamedParams<RetType,ParamsType>(this, sql, params))
        }
    }

    prepareSync<RetType, ParamsType extends DbBinding[]>(sql:TemplateStringsArray|string, ...params: DbBinding[])
        : SyncStatement<RetType, ParamsType> {
        if (IS.tpl(sql)) {
            let sb = ''
            for (let i = 0; i < sql.length; i++) {
                sb += sql[i]
                if (i < params.length) {
                    sb += `$${i+1}`
                }
            }
            return new PostgresStatement(DriverStatement.forPositionalParams<RetType,ParamsType>(this, sb, params))
        } else {
            return new PostgresStatement(DriverStatement.forNamedParams<RetType,ParamsType>(this, sql, params))
        }
    }

    close() { 
        return this.native.end()
    }
    closeSync() { throw NotImplemented() }
}

function propsWithValues(obj:Record<string,any>) {
    return Object.keys(obj).filter(k => obj[k] != null)
}

class PostgresDbConnection extends DbConnection {
    constructor(public connection:PostgresConnection) {
        super(connection)
    }

    quote(symbol:string) { return this.$.quote(symbol) }

    async insert<T extends ClassInstance>(row:T, options?:InsertOptions) {
        const ret:Changes = { changes:0, lastInsertRowid:0 } 
        if (!row) return ret
        const cls = row.constructor as ReflectMeta
        const autoIncrProp = cls.$props.find(p => p.column?.autoIncrement)
        const suffix = autoIncrProp ? ` RETURNING ${this.quote(autoIncrProp.column!.name)}` : ''
        if (options?.onlyProps || options?.onlyWithValues) {
            const onlyProps = options?.onlyProps ?? propsWithValues(row)
            const onlyOptions = { onlyProps }
            let stmt = this.connection.prepare<T,any>(this.schema.insert(cls, onlyOptions) + suffix)
            const dbRow = this.schema.toDbObject(row, onlyOptions)
            const ret = await stmt.exec(dbRow)
            // console.log('insert', ret)
            return ret
        } else {
            let stmt = this.connection.prepare<T,any>(this.schema.insert(cls) + suffix)
            const dbRow = this.schema.toDbObject(row)
            const ret = await stmt.exec(dbRow)
            // console.log('insert', ret)
            return ret
        }
    }

    async insertAll<T extends ClassInstance>(rows:T[], options?:InsertOptions) {
        const ret:Changes = { changes:0, lastInsertRowid:0 } 
        if (rows.length == 0)
            return ret
        const cls = rows[0].constructor as ReflectMeta
        if (options?.onlyProps || options?.onlyWithValues) {
            for (const row of rows) {
                const last = await this.insert(row, options)
                ret.changes += last.changes
                ret.lastInsertRowid = last.lastInsertRowid
            }
        } else {
            let last = null
            const autoIncrProp = cls.$props.find(p => p.column?.autoIncrement)
            const suffix = autoIncrProp ? ` RETURNING ${this.quote(autoIncrProp.column!.name)}` : ''
            let stmt = this.connection.prepare<T,any>(this.schema.insert(cls) + suffix)
            for (const row of rows) {
                const dbRow = this.schema.toDbObject(row)
                last = await stmt.exec(dbRow)
                ret.changes += last.changes
                ret.lastInsertRowid = last.lastInsertRowid
            }
        }
        return ret
    }

    async update<T extends ClassInstance>(row:T, options?:UpdateOptions) {
        const ret:Changes = { changes:0, lastInsertRowid:0 } 
        if (!row)
            return ret
        const cls = row.constructor as ReflectMeta
        if (options?.onlyProps || options?.onlyWithValues) {
            const pkNames = cls.$props.filter(x => x.column?.primaryKey).map(x => x.column!.name)
            const onlyProps = Array.from(new Set([...(options?.onlyProps ?? propsWithValues(row)), ...pkNames ]))
            const onlyOptions = { onlyProps }
            let stmt = this.connection.prepare<T,any>(this.schema.update(cls, onlyOptions))
            const dbRow = this.schema.toDbObject(row, onlyOptions)
            return await stmt.exec(dbRow)
        } else {
            let stmt = this.connection.prepare<T,any>(this.schema.update(cls))
            const dbRow = this.schema.toDbObject(row)
            return await stmt.exec(dbRow)
        }
    }

    async delete<T extends ClassInstance>(row:T, options?:DeleteOptions) {
        const ret:Changes = { changes:0, lastInsertRowid:0 } 
        if (!row)
            return ret
        const cls = row.constructor as ReflectMeta
        let stmt = this.connection.prepare<T,any>(this.schema.delete(cls, options))
        const meta = Meta.assert(cls)
        const pkColumns = meta.props.filter(p => p.column?.primaryKey)
        const onlyProps = pkColumns.map(p => p.name)
        const dbRow = this.schema.toDbObject(row, { onlyProps })
        return stmt.exec(dbRow)
    }

    listTables() { 
        return this.column<string>({ sql: this.schema.sqlTableNames(), params:{} })
    }

    async dropTable<Table extends ClassParam>(table:Table) { 
        let stmt = this.connection.prepare(this.schema.dropTable(table) )
        await stmt.run()
    }

    async createTable<Table extends ClassParam>(table:Table) {
        let stmt = this.connection.prepare(this.schema.createTable(table))
        await stmt.run()
    }

    all<RetType>(strings: TemplateStringsArray | SqlBuilder | Fragment | IntoFragment<RetType>, ...params: any[]) {
        const [stmt, p, into] = this.prepare<RetType>(strings, ...params)
        if (into) {
            const use = (stmt as PostgresStatement<RetType,any>).as(into as Constructor<RetType>)
            return (Array.isArray(p) ? use.all(...p) : use.all(p)) as Promise<RetType[]>
        } else {
            return Array.isArray(p) ? stmt.all(...p) : stmt.all(p)
        }
    }

    one<RetType>(strings: TemplateStringsArray | SqlBuilder | Fragment | IntoFragment<RetType>, ...params: any[]) {
        const [stmt, p, into] = this.prepare<RetType>(strings, ...params)
        if (into) {
            const use = (stmt as PostgresStatement<RetType,any>).as(into as Constructor<RetType>)
            return (Array.isArray(p) ? use.one(...p) : use.one(p)) as Promise<Awaited<RetType> | null>
        } else {
            return (Array.isArray(p) ? stmt.one(...p) : stmt.one(p)) as Promise<Awaited<RetType> | null>
        }
    }

    async column<ReturnValue>(strings: TemplateStringsArray | SqlBuilder | Fragment, ...params: any[]) {
        const [stmt, p] = this.prepare<ReturnValue>(strings, ...params)
        return Array.isArray(p) 
            ? (await stmt.arrays(...p)).map(x => x[0] as ReturnValue) 
            : (await stmt.arrays(p)).map(x => x[0] as ReturnValue) 
    }

    async value<ReturnValue>(strings: TemplateStringsArray | SqlBuilder | Fragment, ...params: any[]) {
        const [stmt, p, into] = this.prepare<ReturnValue>(strings, ...params)
        const value = Array.isArray(p) 
            ? await stmt.value(...p) 
            : await stmt.value(p)
        if (into) {
            if (into as any === Boolean) {
                return !!value
            }
        }
        return value
    }

    arrays(strings: TemplateStringsArray | SqlBuilder | Fragment, ...params: any[]) {
        const [stmt, p] = this.prepare(strings, ...params)
        return Array.isArray(p) 
            ? stmt.arrays(...p)
            : stmt.arrays(p)
    }

    array(strings: TemplateStringsArray | SqlBuilder | Fragment, ...params: any[]) {
        const [stmt, p] = this.prepare(strings, ...params)
        return Array.isArray(p) 
            ? stmt.array(...p)
            : stmt.array(p)
    }

    exec(strings:TemplateStringsArray | SqlBuilder | Fragment, ...params:any[]) {
        const [stmt, p] = this.prepare(strings, ...params)
        // console.log('exec', (stmt as any).query, p)
        return Array.isArray(p) && !IS.tpl(strings) ? stmt.exec(...p) : stmt.exec(p as any)
    }

    async run(strings:TemplateStringsArray | SqlBuilder | Fragment, ...params:any[]) {
        const [stmt, p] = this.prepare(strings, ...params)
        if (Array.isArray(p)) {
            await stmt.run(...p)
        } else {
            await stmt.run(p)
        }
    }

    close() {
        return this.connection.close()
    }
}