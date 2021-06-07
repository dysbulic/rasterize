const CDP = require('chrome-remote-interface')
const fs = require('fs')
const yargs = require('yargs')

const argv = (
  yargs
  .option('iters', {
    alias: 'i',
    description: 'Number of iterations [default 20]',
    type: 'number',
  })
  .option('url', {
    alias: 'u',
    description: 'URL to load [required]',
    type: 'string',
  })
  .option('prefix', {
    alias: 'p',
    description: 'Image filename prefix [default "shot"]',
    type: 'string',
  })
  .option('width', {
    alias: 'w',
    description: 'Width to render [default 200]',
    type: 'number',
  })
  .option('height', {
    alias: 'h',
    description: 'Height to render [default 200]',
    type: 'number',
  })
  .option('drop', {
    alias: 'd',
    description: 'Frames to drop between captures [defualt 0]',
    type: 'number',
  })
  .help()
  .argv
)

if(!argv.url) throw new Error('--url is required')

CDP(async (client) => {
  const { Page, Runtime } = client
  const {
    url, iters = 20, width = 200, height = 200,
    prefix = 'shot', drop = 0,
  } = argv
  const color = { r: 255, g: 255, b: 255, a: 0 }

  try {
    await Page.enable()
    await client.Emulation.setDeviceMetricsOverride({
      width, height,
      fitWindow: true,
      deviceScaleFactor: 1,
      mobile: false
    })
    await Page.navigate({ url })
    await Page.loadEventFired()
    await client.Emulation.setDefaultBackgroundColorOverride({
      color
    })
    await Page.startScreencast({ format: 'png', everyNthFrame: 1 });
    let counter = 1
    while(counter <= iters) {
      const { data, metadata, sessionId } = (
        await Page.screencastFrame()
      )
      const out = `${prefix}.${(counter++).toString().padStart(3, '0')}.png`
      fs.writeFileSync(
        out, Buffer.from(data, 'base64')
      )
      console.info(`Creating: ${out}`)
      await Page.screencastFrameAck({ sessionId })
      for(let i = 1; i <= drop; i++) {
        const { data, metadata, sessionId } = (
          await Page.screencastFrame()
        )
        await Page.screencastFrameAck({ sessionId })
      }
    }
  } finally {
    client.close()
  }
}).on('error', (err) => {
  console.error(err)
})