const CDP = require('chrome-remote-interface')
const fs = require('fs')

CDP(async (client) => {
  const { Page, Runtime } = client
  const url = 'https://dhappy.org/.../image/flag/Anarchist/rolling.svg'

  try {
    await Page.enable()
    await client.Emulation.setDeviceMetricsOverride({
      width: 200, height: 200,
      fitWindow: true,
      deviceScaleFactor: 1,
      mobile: false
    })
    await Page.navigate({ url })
    await Page.loadEventFired()
    await Page.startScreencast({ format: 'png', everyNthFrame: 1 });
    let counter = 1
    while(counter < 50){
      const { data, metadata, sessionId } = (
        await Page.screencastFrame()
      )
      fs.writeFileSync(
        `flag.${(counter++).toString().padStart(2, '0')}.png`, Buffer.from(data, 'base64')
      )
      console.log(metadata)
      await Page.screencastFrameAck({ sessionId })
    }
  } finally {
    client.close()
  }
}).on('error', (err) => {
  console.error(err)
})