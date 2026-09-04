import { createApp } from './gateway/app.js'
import { buildContainer } from './gateway/container.js'

const porta = Number(process.env.PORT ?? 3333)

createApp(buildContainer()).listen(porta, () => {
  console.log(`sync api ouvindo em http://localhost:${porta}`)
})
