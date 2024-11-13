import { connect } from "../src"

export const connection = connect({ hostname:'localhost',database:'test',user:'test',password:'test' })
export const { $, async: db } = connection