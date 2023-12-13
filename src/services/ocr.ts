import path from 'node:path';
import { createWorker } from 'tesseract.js'

import * as izusApi from '../apis/izus.js'
import { scriptDirname } from '../utils/utils.js';


export default async function doOCR(fileName: string, version: izusApi.Version) {
  const lang = version === 'sk' ? 'slk' : 'ces'
  const cachePath = path.join(scriptDirname(import.meta.url), 'ocr')
  const worker = await createWorker(lang, undefined, { cachePath });
  const ret = await worker.recognize(fileName);
  worker.terminate();
  return ret.data.text
}
