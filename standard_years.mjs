#!/usr/bin/env node

/* Rename files from YYYY-MM-DD to YYYY⁄MM⁄DD
 */

import fs from 'node:fs'
import glob from 'glob'
import yargs from 'yargs'
import path from 'node:path'

const args = (
  yargs(process.argv.slice(2))
  .command('* [paths...]', (
    'Rename files from YYYY-MM-DD to YYYY⁄MM⁄DD in the given paths.'
  ))
  .demandOption('paths')
  .alias('h', 'help')
  .help()
  .showHelpOnFail(true, 'HELP!')
)
const argv = await args.argv

if(!argv.paths) {
  yargs.showHelp()
  process.exit(2)
}

const paths = (
  Array.isArray(argv.paths) ? argv.paths : Object.values(argv.paths)
)
paths.forEach((dir) => {
  glob.sync(path.join(dir, '*')).forEach((full) => {
    const file = path.basename(full)
    const [match, year, month, day, rest] = (
      file.match(/^(\d{4})-(\d{2})-(\d{2})(.+)$/) ?? []
    )
    if(match) {
      const newFile = `${year}⁄${month}⁄${day}${rest}`
      const newFull = path.join(dir, newFile)
      if(fs.existsSync(newFull)) {
        console.error(`File already exists: ${newFull}`)
      } else {
        fs.renameSync(full, newFull)
        console.debug(`${file} → ${newFile}`)
      }
    }
  })
})
