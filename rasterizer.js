#!/usr/bin/env node

import { default as CRI } from 'chrome-remote-interface'
import fs from 'node:fs'
import yargs from 'yargs/yargs'
import path from 'node:path'

const argv = (
  await yargs(process.argv.slice(2))
  .option('iters', {
    alias: 'i',
    default: 20,
    description: 'Number of iterations',
    type: 'number',
  })
  .option('url', {
    alias: 'u',
    description: 'URL to load [required]',
    type: 'string',
    required: true,
  })
  .option('prefix', {
    alias: 'p',
    default: 'shot',
    description: 'Image filename prefix',
    type: 'string',
  })
  .option('width', {
    alias: 'w',
    default: 200,
    description: 'Width to render',
    type: 'number',
  })
  .option('height', {
    alias: 'h',
    default: 200,
    description: 'Height to render',
    type: 'number',
  })
  .option('drop', {
    alias: 'd',
    default: 0,
    description: 'Frames to drop between captures',
    type: 'number',
  })
  .option('verbose', {
    alias: 'v',
    description: 'Print additional information',
  })
  .help()
  .showHelpOnFail(true)
  .argv
)

if(!argv.url) {
  throw new Error('URL is required.')
}
if(!/^\w+:\/\//.test(argv.url)) {
  // @ts-ignore
  argv.url = `file://${path.join(process.cwd(), argv.url)}`
}

if(argv.verbose) {
  console.debug(`Args: ${JSON.stringify(argv, null, 2)}`)
}

CRI({}, async (client) => {
  const { Page } = client
  const {
    url, iters, width, height, prefix, drop,
  } = argv
  const color = { r: 255, g: 255, b: 255, a: 0 }

  try {
    await Page.enable()
    await client.Emulation.setDeviceMetricsOverride({
      width, height,
      // fitWindow: true,
      deviceScaleFactor: 1,
      mobile: false
    })

    if(argv.verbose) console.info(`Rendering: ${url}`)

    await Page.navigate({ url })
    await Page.loadEventFired()
    await client.Emulation.setDefaultBackgroundColorOverride({
      color
    })
    await Page.startScreencast({ format: 'png', everyNthFrame: 1 });
    let counter = 1
    while(counter <= iters) {
      const { data, sessionId } = (
        await Page.screencastFrame()
      )
      const out = `${prefix}.${(counter++).toString().padStart(4, '0')}.png`
      fs.writeFileSync(
        out, Buffer.from(data, 'base64')
      )
      if(argv.verbose) console.info(`Creating: ${out}`)
      await Page.screencastFrameAck({ sessionId })
      for(let i = 1; i <= drop; i++) {
        const { sessionId } = await Page.screencastFrame()
        await Page.screencastFrameAck({ sessionId })
      }
    }
  } finally {
    client.close()
  }
})
