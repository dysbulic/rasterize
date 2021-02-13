const CDP = require('chrome-remote-interface')
const fs = require('fs')
const yargs = require('yargs')

const argv = (
  yargs
  .option('iters', {
    alias: 'i',
    description: 'Number of iterations',
    type: 'number',
  })
  .option('url', {
    alias: 'u',
    description: 'URL to load',
    type: 'string',
  })
  .option('width', {
    alias: 'w',
    description: 'Width to render',
    type: 'number',
  })
  .option('height', {
    alias: 'h',
    description: 'Height to render',
    type: 'number',
  })
  .help()
  .argv
)

if(!argv.url) throw new Error('--url is required')

CDP(async (client) => {
  const { Page, Runtime } = client
  const { url, iters = 20, width = 200, height = 200 } = argv

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
    await Page.startScreencast({ format: 'png', everyNthFrame: 1 });
    let counter = 1
    while(counter <= iters) {
      const { data, metadata, sessionId } = (
        await Page.screencastFrame()
      )
      const out = `flag.${(counter++).toString().padStart(2, '0')}.png`
      fs.writeFileSync(
        out, Buffer.from(data, 'base64')
      )
      console.info(`Creating: ${out}`)
      await Page.screencastFrameAck({ sessionId })
    }
  } finally {
    client.close()
  }
}).on('error', (err) => {
  console.error(err)
})