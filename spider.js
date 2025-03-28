#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import yargs from 'yargs'
import puppeteer from 'puppeteer'
import pluralize from 'pluralize'
import { URL } from 'url'
import progress from 'cli-progress'
import glob from 'glob'

const dirname = path.dirname(new URL(import.meta.url).pathname)

const sleep = (timeout) => (
  new Promise((r) => setTimeout(r, timeout))
)

const timeBar = async (time) => {
  const bar = new progress.Bar({
    format: (
      ' >> [\u001b[32m{bar}\u001b[0m] {percentage}%'
      + ' | ETA: {eta}s | {value}/{total}'
    ),

    // same chars for bar elements, just separated by colors
    barCompleteChar: '█',
    barIncompleteChar: '▒',

    // change color to yellow between bar complete/incomplete -> incomplete becomes yellow
    barGlue: '\u001b[33m',
  })
  bar.start(time, 0)

  const step = 1000
  let current

  for(current = 0; current < time; current += step) {
    bar.update(current)
    await sleep(step)
  }
  bar.update(current)

  bar.stop()
}

const processStopper = {
  wait({ link, page, timeout, chalk }) {
    if(!link) {
      console.warn('Error: Link not found.')
    } else {
      try {
        return new Promise(async (resolve, reject) => {
          this.resolve = resolve
          this.reject = reject

          try {
            await Promise.all([
              page.waitForNavigation({
                timeout: timeout ?? 5 * 60 * 1000
              }),
              link.click(),
            ])
          } catch(err) {
            console.error(
              chalk.bold.hex('#FF8F34')('Error: ')
              + chalk.red(err.message)
            )
            reject(err.message)
          }
        })
      } catch(err) {
        console.error(err.message)
      }
    }
  },
  async unblock({ url, chalk: _chalk }) {
    const { resolve, base } = this
    resolve?.({ url, base })
  }
}

let client // accessed in main `catch`

const allowDownloads = async () => {
  if(client) {
    const dls = path.join(process.env.HOME ?? '~', 'Downloads')
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: dls,
    })
  }
}


const main = async () => {
  process.on('SIGINT', () => { throw new Error('Interrupted') })
  process.on('SIGTERM', () => { throw new Error('Terminated') })

  const args = (
    yargs(process.argv.slice(2))
    .command(
      '* [urls..]',
      (
        "This program is for downloading and saving the art from Vecteezy.com using Puppeteer.\n\n"
        + "It requires `google-chrome --remote-debugging-port=9222` be run prior.\n\n"
        + `Ran: ${process.argv.join(' ')}`
      ),
    )
    .option('headless', {
      type: 'boolean',
      default: false,
      alias: 's',
    })
    .option('config', {
      type: 'string',
      default: 'http://localhost:9222/json/version',
      alias: 'c',
    })
    .option('max-page', {
      type: 'number',
      default: Infinity,
      alias: 'x',
    })
    .option('min-page', {
      type: 'number',
      default: 1,
      alias: 'n',
    })
    .option('total', {
      type: 'number',
      default: 1_000,
      alias: 't',
      description: 'Total number of URLs to download.',
    })
    .option('page-timeout', {
      type: 'number',
      default: 10 * 60,
      alias: 'p',
      description: 'Number of seconds to wait on page operations.',
    })
    .option('per-day', {
      type: 'number',
      default: null,
      alias: 'd',
      description: 'Number of images to download per day. (Overrides `link-wait` if specified.)',
    })
    .option('link-wait', {
      type: 'number',
      default: 30,
      alias: 'w',
      description: 'Number of seconds to wait on link clicks.',
    })
    .option('click-delay', {
      type: 'number',
      default: 7,
      alias: 'c',
      description: 'Number of seconds to wait between link clicks.',
    })
    .option('fixed', {
      type: 'boolean',
      default: false,
      alias: 'f',
      description: (
        'Cut the images to be spidered off at `total`'
        + ' rather than completing the page.'
      ),
    })
    .option('verbose', {
      type: 'boolean',
      default: false,
      alias: 'v',
      description: 'Print more information.',
    })
    .demandOption('urls')
    .alias('h', 'help')
    .help()
    .showHelpOnFail(true, 'HELP!')
  )
  const argv = await args.argv

  const chalk = (await import('chalk')).default
  const fetch = (await import('node-fetch')).default
  const configResponse = await fetch(argv.config)
  const config = await configResponse.json()
  if(!(config instanceof Object)) throw new Error('Bad config.')
  if(!('webSocketDebuggerUrl' in config)) {
    throw new Error('Missing `webSocketDebuggerUrl` in `config`.')
  }
  const endpoint = config.webSocketDebuggerUrl
  if(typeof endpoint !== 'string') {
    throw new Error(`"${typeof endpoint}" typed endpoint.`)
  }

  if(argv.perDay) {
    argv.clickDelay = Math.ceil((24 * 60 * 60) / argv.perDay)
  }

  console.info(`Connecting to: ${chalk.blueBright(endpoint)}`)

  const browser = (
    argv.headless ? (
      await puppeteer.launch({ headless: argv.headless })
    ) : (
      await puppeteer.connect({
        browserWSEndpoint: endpoint,
        defaultViewport: null,
      })
    )
  )

  let urls = []
  let count = 0
  let page = await browser.newPage()
  client = await page.target().createCDPSession()
  let filename, name

  page.on('response', async (res) => {
    try {
      if(res.status() < 300) {
        const request = await res.request()
        const url = new URL(request.url())

        let file = url.pathname.split('/').at(-1) ?? (() => { throw new Error(`Bad \`url\`: ${url}.`) })()
        if(file.endsWith('.zip')) {
          console.debug(`Processing: ${chalk.hex('#9E78FF')(url)}`)
          console.debug(`  [${chalk.hex('#9E7922')(page.url())}]`)

          const creator = (await page.$eval(
            '.contributor-details__contributor__name',
            (elem) => elem.textContent,
          ))
          ?.trim()
          .replace(/\//g, '／')

          const dlPath = `./mirror/${url.host}/${creator}`
          try {
            await fs.promises.access(dlPath, fs.constants.F_OK)
          } catch(dne) {
            console.debug(chalk.hex('#FF5AD9')(`Creating: ${dlPath}`))
            await fs.promises.mkdir(dlPath, { recursive: true })
          }

          if(!filename.endsWith('.zip')) filename += '.zip'
          try {
            await fs.promises.access(
              path.join(dlPath, file), fs.constants.F_OK
            )
            console.error(chalk.red(`Renaming ${file} to ${filename}`))
            fs.renameSync(path.join(dlPath, file), path.join(dlPath, filename))
          } catch(dne) {
            const out = path.join(dlPath, filename)
            try {
              await fs.promises.access(out, fs.constants.F_OK)
              console.error(chalk.red(`${out} Exists; Skipping.`))
            } catch(dne) {
              console.debug(
                `${chalk.hex('#60D700')(new Date().toISOString())}: `
                + `Downloading To: ${chalk.hex('#8BB8DE')(out)}`
              )
              try {
                const dl = await fetch(url.toString())
                const fileStream = fs.createWriteStream(out)
                await new Promise((resolve, reject) => {
                  dl.body?.on('error', reject)
                  fileStream.on('finish', resolve)
                  dl.body?.pipe(fileStream)
                })
              } catch(error) {
                console.error({ error })
              }
            }
          } finally {
            await timeBar(argv.clickDelay * 1000)
            await processStopper.unblock({
              url: url.toString(), chalk
            })
          }
        }
      }
    } catch(err) {
      console.error(chalk.red(err.message))
    }
  })

  if(!Array.isArray(argv.urls)) throw new Error('Bad `urls`.')

  for(let urlString of argv.urls) {
    if(!/^(https?:)?\/\//.test(urlString)) {
      urlString = `https://vecteezy.com/search?qterm=${encodeURI(urlString)}`
    }
    const url = new URL(
      `${
        urlString
      }${/[?&]page=/i.test(urlString) ? '' : (
        `${
          urlString.includes('?') ? '&' : '?'
        }page=${
          argv.minPage
        }`
      )}`
    )
    console.debug(`Processing: ${chalk.hex('#45DE29')(url)}`)

    let next
    let pageNum = 1
    const delta = Math.max(0, argv.maxPage - argv.minPage)
    let total = 0

    await page.goto(url.toString(), { waitUntil: 'networkidle2' })

    outer:
    while(pageNum++ <= delta && (argv.total == null || urls.length < argv.total) && next !== null) {
      const selector = '.ez-resource-grid__item'
      const items = await page.$$(selector)
      for(const elem of items) {
        const linkElem = await elem.$('.ez-resource-thumb__link')
        const href = await linkElem?.evaluate((l) => 'href' in l && l.href)
        if(typeof href !== 'string') {
          console.error(`Bad \`href\` (${typeof href}).`)
          continue
        }
        const filename = `${href.replace(/^.*\//g, '')}.zip`
        const urlWildcard = url.host.replace(/^.*\.([^.]+)\.([^.]+)$/, '*.$1.$2')
        if(argv.verbose) {
          console.info(
            chalk.hex('#639DF4')('Checking ')
            + chalk.hex(urls.length < argv.total ? '#730022' : '#12CD43')(`#${urls.length + 1}`)
            + chalk.hex('#855')(`(${urls.length - argv.total})`)

            + chalk.hex('#EBC500')('/')
            + chalk.hex('#CB61F6')(++total)
            + chalk.hex('#EBC500')(': ')
            + chalk.hex('#FFAAFF')(`${urlWildcard}: ${filename}`)
          )
        }
        let [match] = glob.sync(path.join(
          dirname, 'mirror', urlWildcard, '*', filename
        ))
        if(!match) {
          [match] = glob.sync(path.join(
            dirname, 'mirror', '*', '*', filename
          ))
        }
        if(match) {
          console.info(
            `${chalk.hex('#FF7B2E')(match.replace(dirname, ''))} is present;`
            + ` ${chalk.redBright('Skipping…')}`
          )
        } else if(/\/(photo|video)\//.test(href)) {
          console.info(
            `${chalk.hex('#7BFF2E')(filename)} is a photo;`
            + ` ${chalk.redBright('Skipping…')}`
          )
        } else {
          urls.push(href)
          if(urls.length >= argv.total && argv.fixed) {
            break outer
          }
        }
      }
      console.debug(
        `  ${chalk.hex('#AB32DE')(`Page #${++count}`)}`
        + ` (${chalk.hex('#FFAAFF')(pluralize('URL', urls.length, true))})`
        + ` [${chalk.green(page.url())}]`
      )
      ;([next] = await page.$x("//a[contains(., 'Next page')]"))
      if(!next) {
        [next] = await page.$x("//a[contains(., 'Next Page')]")
      }
      if(!next) {
        [next] = await page.$x("//a[contains(., 'Show more results')]")
      }

      const className = (await next?.getProperty('className'))?.toString()
      if(!className || className.includes('is-disabled')) {
        next = null
      }

      if(next === null) {
        console.debug(chalk.yellow(`No next page after #${count}.`))
      } else {
        let timeout = Math.max(argv.clickDelay, argv.linkTimeout) * 1000
        await Promise.all([
          page.waitForNavigation({ timeout }),
          next.click(),
        ])
      }
    }
  }

  count = 0
  urls = [...new Set(urls)]
  console.debug(chalk.hex('#C1A40F')(
    `Downloading ${pluralize('URL', urls.length, true)}`
  ))

  for(const url of urls) {
    try {
      const pgperday = (
        24 * 60 * 60 / argv.clickDelay
      )
      console.debug(
          chalk.hex('##FA0')(`${++count} / ${urls.length}`)
        + `${chalk.hex('#2A7177')(`@${Math.round(pgperday)}`)}dl⁄day:`
        + ` Loading: ${chalk.green(url)}`
      )
      await page.goto(url, { waitUntil: 'networkidle0' })

      filename = url.replace(/.*\//g, '')

      const [desc] = await page.$x("//meta[@itemprop='description']")
      if(desc) {
        name = await (await desc.getProperty('content')).jsonValue()
      } else {
        console.debug('Couldn’t find description!')
        name = null
      }

      const [link] = await page.$x("//button[contains(text(), 'Download Now')]")
      if(!link) {
        throw new  Error('Couldn’t find “Download Now” link.')
      } else {
        await client.send('Page.setDownloadBehavior', {
          behavior: 'deny',
        })
        await processStopper.wait({
          link, page, timeout: (argv.clickDelay + argv.linkTimeout) * 1000, chalk,
        })
        // await link.click()
        // await page.waitForNavigation()
        // await page.waitForTimeout(30000)
        // await timeBar(30000)
      }
    } catch(err) {
      console.error(`Loading Error: ${chalk.red(err.message ?? err)}`)
    }
  }
}

main()
.then(() => {
  console.debug('Exited Normally')
  return 0
})
.catch(async (reason) => {
  console.error(`Error: "${reason.message ?? reason}"`)
  return 23
})
.finally(async (status) => {
  console.debug(`Reenabling Downloads & Exiting #${status}…`)
  await allowDownloads()
  process.exit(status)
})
