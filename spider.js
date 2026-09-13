#!/usr/bin/env node

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import yargs from 'yargs'
import puppeteer from 'puppeteer'
import pluralize from 'pluralize'
import { URL } from 'url'
import progress from 'cli-progress'
import * as glob from 'glob'
import chalk from 'chalk'

const dirname = path.dirname(new URL(import.meta.url).pathname)

const main = async () => {
  process.on('SIGINT', () => { throw new Error('Interrupted') })
  process.on('SIGTERM', () => { throw new Error('Terminated') })

  const argv = await args()

  const configResponse = await fetch(argv.config)
  const config = await configResponse.json()
  if(!(config instanceof Object)) throw new Error('Bad config.')
  if(!('webSocketDebuggerUrl' in config)) {
    throw new Error('Missing `webSocketDebuggerUrl` in `config`.')
  }
  if(typeof config.webSocketDebuggerUrl !== 'string') {
    throw new Error(`"${typeof config.webSocketDebuggerUrl}" typed endpoint.`)
  }

  if(argv.perDay) {
    argv.clickDelay = Math.max(
      argv.clickDelay,
      Math.ceil((24 * 60 * 60) / argv.perDay),
    )
  } else {
    argv.perDay = (24 * 60 * 60) / argv.clickDelay
  }

  console.info(
    `Connecting to: ${chalk.blueBright(config.webSocketDebuggerUrl)}`
  )

  const browser = (
    argv.headless ? (
      await puppeteer.launch({ headless: argv.headless })
    ) : (
      await puppeteer.connect({
        browserWSEndpoint: config.webSocketDebuggerUrl,
        defaultViewport: null,
        protocolTimeout: argv.cdpTimeout * 1_000,
      })
    )
  )

  let count = 0
  for await (const url of images({ argv, browser })) {
    console.debug(
      chalk.hex('#FA0')(`${++count} / ${argv.total}`)
      + `${chalk.hex('#2A7177')(`@${Math.round(argv.perDay)}`)}dl⁄day:`
      + ` Loading: ${chalk.green(url)}`
    )
    const { saved } = await download({ url, browser, argv })
    console.debug(
      chalk.bgWhite.gray('Saved To:')
      + ` ${chalk.bgWhite.hex('#ED6B1D')(saved)}`
    )
  }
}

main()
.then(() => {
  console.debug('Exited Normally')
  return 0
})
.catch((reason) => {
  console.error({ 'Main Error': reason })
  return 23
})
.finally((status) => {
  console.debug(`Exiting: #${status}…`)
  process.exit(status)
})

const sleep = (timeout) => (
  new Promise((r) => setTimeout(r, timeout))
)

const timeBar = async (time) => {
  const barColor = (percent) => {
    if(percent <= 25) {
      return '38;2;192;37;41;48;5;25'
    } else if(percent <= 50) {
      return '38;2;225;62;28;48;5;13'
    } else if(percent <= 75) {
      return '38;5;57;48;5;4'
    } else {
      return '38;2;44;196;43;48;5;45'
    }
  }
  const format = (options, params) => {
    class BarSize {
      #total = options.barsize
      #complete = Math.round(params.progress * this.#total)
      get complete() { return this.#complete }
      get remaining() { return this.#total - this.#complete }
    }
    const size = new BarSize()
    const percentage = Math.floor(params.progress * 10_000) / 100
    const barElems = [
      ' >> '
      + '['
      + `\u001b[${barColor(percentage)}m`
      + options.barCompleteChar.repeat(size.complete)
      + options.barGlue
      + options.barIncompleteChar.repeat(size.remaining)
      + '\u001b[0m'
      + ']'
      + ` \u001b[${barColor((percentage + 25) % 100)}m`
      + `${percentage.toFixed(2)}%`
      + '\u001b[0m'
      + ' | ETA:'
      + ` ${Math.round(params.total / 1_000)}s`
      + ` − ${Math.round(params.value / 1_000)}s`
      + ` ≈ ${params.eta}s`
    ]
    return barElems.join('')
  }
  const bar = new progress.Bar({
    format,
    barCompleteChar: '█',
    barIncompleteChar: '▒',
    barGlue: '\u001b[33;1m',
    BarSize: 130,
  })
  bar.start(time, 0)

  const step = 500
  let current

  for(current = 0; current < time; current += step) {
    bar.update(current)
    await sleep(step)
  }
  bar.update(current)

  bar.stop()
}

async function args() {
  const args = (
    yargs(process.argv.slice(2))
    .command(
      '* [urls..]',
      (
        'This program is for downloading and saving the art'
        + ' from Vecteezy.com using Puppeteer.'
        + "\n\n"
        + "Run `google-chrome --remote-debugging-port=9222` first.\n\n"
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
      default: Infinity,
      alias: 't',
      description: 'Total number of URLs to download.',
    })
    .option('cdp-timeout', {
      type: 'number',
      default: 45,
      alias: 'r',
      description: (
        'Number of seconds to wait on Chrome DevTools Protocol operations.'
      ),
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
      description: (
        'Number of images to download per day.'
        + ' (Overrides `link-wait` if specified.)'
      ),
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
      alias: 'l',
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
  const { argv } = args
  if(argv.verbose) {
    console.debug({ Arguments: argv })
  }
  return argv
}

async function* images({ argv, browser }) {
  let urls = []
  let count = 0
  let urlsPage = await browser.newPage()

  if(!Array.isArray(argv.urls)) throw new Error('Bad `urls`.')

  for(let urlString of argv.urls) {
    if(!/^(https?:)?\/\//.test(urlString)) {
      urlString = `https://vecteezy.com/search?qterm=${encodeURI(urlString)}`
    }
    const url = new URL(
      `${
        urlString
      }${/[?&]page=/i.test(urlString) || argv.minPage === 1 ? '' : (
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

    await urlsPage.goto(url.toString(), { waitUntil: 'networkidle2' })

    outer:
    while(
      pageNum++ <= delta
      && (argv.total == null || urls.length < argv.total)
      && next !== null
    ) {
      const selector = '.ez-resource-grid__item'
      const items = await urlsPage.$$(selector)
      for(const elem of items) {
        const linkElem = await elem.$('.ez-resource-thumb__link')
        const href = await linkElem?.evaluate((l) => 'href' in l && l.href)
        if(typeof href !== 'string') {
          console.error(`Bad \`href\` (${typeof href}).`)
          continue
        }
        const filename = `${href.replace(/^.*\//g, '')}.*`
        const urlWildcard = (
          url.host.replace(/^.*\.([^.]+)\.([^.]+)$/, '*.$1.$2')
        )
        if(argv.verbose) {
          console.info(
            chalk.hex('#639DF4')('Checking ')
            + chalk.hex(
              urls.length < argv.total ? '#730022' : '#12CD43'
            )(`#${urls.length + 1}`)
            + chalk.hex('#855')(`(${urls.length - argv.total})`)

            + chalk.hex('#EBC500')('/')
            + chalk.hex('#CB61F6')(++total)
            + chalk.hex('#EBC500')(': ')
            + chalk.hex('#FFAAFF')(`${urlWildcard}: ${filename}`)
          )
        }
        const specificPattern = path.join(
          dirname, 'mirror', urlWildcard, '*', filename
        )
        if(argv.verbose) {
          console.debug(
            chalk.yellow('Checking:')
            + ` ${chalk.hex('#E30DCF')(specificPattern)}`
          )
        }
        let [match] = glob.sync(specificPattern)
        if(!match) {
          const generalPattern = path.join(
            dirname, 'mirror', '*', '*', filename
          )
          if(argv.verbose) {
            console.debug(
              chalk.yellow('Generalizing Check:')
              + ` ${chalk.hex('#E30DCF')(generalPattern)}`
            )
          }
          ;[match] = glob.sync(generalPattern)
        }
        if(match) {
          console.info(
            `${chalk.hex('#FF7B2E')(match.replace(dirname, ''))} is present;`
            + ` ${chalk.redBright('Skipping…')}`
          )
        } else if(/\/(photo|video|png|psd|vnd.adobe.photoshop)\//.test(href)) {
          console.info(
            `${chalk.hex('#7BFF2E')(filename)} is a photo;`
            + ` ${chalk.redBright('Skipping…')}`
          )
        } else {
          yield new URL(href)
          if(urls.length >= argv.total && argv.fixed) {
            break outer
          }
        }
      }
      console.debug(
        `  ${chalk.hex('#AB32DE')(`Page #${++count}`)}`
        + ` (${chalk.hex('#FFAAFF')(pluralize('URL', urls.length, true))})`
        + ` [${chalk.green(urlsPage.url())}]`
      )
      ;(next = await urlsPage.$('a ::-p-text(Next page)'))
      if(!next) {
        next = await urlsPage.$('a ::-p-text(Show more results)')
      }

      const className = (await next?.getProperty('className'))?.toString()
      if(!className || className.includes('is-disabled')) {
        next = null
      }

      if(next == null) {
        console.debug(chalk.yellow(`No next page after #${count}.`))
      } else {
        const timeout = Math.max(argv.clickDelay, argv.linkTimeout) * 1_000
        await Promise.all([
          urlsPage.waitForNavigation({ timeout }),
          next.click(),
        ])
      }
    }
  }
}

let downloadPage

class State {
  dlURL
  guid
  creator
  unwait
  sourceURL
}
const state = new State()

async function download({ url: sourceURL, browser, argv }) {
  const downloadPath = path.resolve(os.homedir(), 'Downloads')
  state.sourceURL = sourceURL

  if(downloadPage == null) {
    downloadPage = await browser.newPage()
    const client = await downloadPage.createCDPSession()
    await client.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath,
      eventsEnabled: true, // necessary; false by default
    })

    client.on(
      'Browser.downloadWillBegin',
      ({ url, guid: target }) => {
        state.guid = target
        state.dlURL = new URL(url)
      }
    )
    client.on('Browser.downloadProgress', (evt) => {
      if(evt.guid === state.guid && evt.state === 'completed') {
        if(!state.creator) throw new Error('`creator` not set.')
        Object.entries(
          { dlURL: state.dlURL, sourceURL: state.sourceURL }
        ).forEach(([name, url]) => {
          if(!(url instanceof URL)) {
            throw new Error(`Bad \`${name}\`: "${url}"`)
          }
        })

        const destPath = (
          path.join('.', 'mirror', state.dlURL.host, state.creator)
        )
        fs.mkdirSync(destPath, { recursive: true })

        const destFile = (
          state.sourceURL.pathname.split('/').at(-1)
          + `${path.extname(state.dlURL.pathname)}`
        )
        const destFull = path.join(destPath, destFile)
        const saveFull = path.join(
          downloadPath,
          state.dlURL.pathname.split('/').at(-1),
        )

        fs.copyFile(saveFull, destFull, () => {
          fs.unlinkSync(saveFull)
          state.unwait(
            { downloaded: saveFull, saved: destFull }
          )
        })
      }
    })
  }

  await downloadPage.goto(sourceURL, { waitUntil: 'networkidle0' })

  state.creator = (await downloadPage.$eval(
    '.contributor-details__contributor__name',
    (elem) => elem.textContent,
  ))
  ?.trim()
  .replace(/\//g, '／')
  ?? '𝓾𝓷𝓴𝓷𝓸𝔀𝓷'

  let link = await downloadPage.$('button ::-p-text(Download Now)')
  const options = await downloadPage.$(
    "button[data-action='click->ez-drop-down#handleSubMenuClick']"
  )
  if(options) {
    try {
      console.info(chalk.orange('Checking options…'))
      await options.click()
      const svgLink = await downloadPage.$('button ::-p-text(SVG)')
      if(svgLink) link = svgLink
    } catch(err) {
      console.error(
        `${chalk.orange('Options Click:')} ${chalk.blue(err.message)}`
      )
    }
  }
  if(!link) {
    throw new Error('Couldn’t find “SVG” or “Download Now” link.')
  } else {
    const barTime = (argv.clickDelay + argv.linkWait) * 1_000
    const awaitDl = new Promise(
      (resolve) => { state.unwait = resolve }
    )
    const [names] = await Promise.all([
      awaitDl,
      link.click(),
      timeBar(barTime),
    ])
    return names
  }
}
