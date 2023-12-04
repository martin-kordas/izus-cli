import { runCli } from './cli.js'
import * as i18n from './services/i18n.js'
import { handleError } from './utils/utils.js'


try {
  await i18n.init()
  await runCli()
}
catch (err) {
  handleError(err)
}
