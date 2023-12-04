import path from 'node:path'
import process from 'node:process'
import { promises as fs } from 'node:fs'
import chalk from 'chalk'
import { t } from 'i18next'
import { drive_v3, google } from 'googleapis'
import { authenticate } from '@google-cloud/local-auth'
import { GlobalOptions } from 'googleapis/build/src/apis/abusiveexperiencereport'

import { scriptDirname } from '../utils/utils.js'
import { Logger } from '../utils/types.js'
import { JSONClient } from '../../node_modules/@google-cloud/local-auth/node_modules/google-auth-library/build/src/auth/googleauth.js'


type GoogleClient = JSONClient // OAuth2Client | JSONClient

type DriveProvider = {
  drive?: drive_v3.Drive
  readonly scopes: string[]
  readonly tokenPath: string
  readonly credentialsPath: string

  get(): Promise<drive_v3.Drive>

  [key: string]: any
}


const resourcesPath = path.join(scriptDirname(import.meta.url), 'resources')

// https://github.com/googleworkspace/node-samples/blob/main/drive/quickstart/index.js
const driveProvider: DriveProvider = {
  drive: undefined,
  // If modifying these scopes, delete token.json.
  scopes: [
    'https://www.googleapis.com/auth/drive.metadata.readonly',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/drive.readonly'
  ],
  // The file token.json stores the user's access and refresh tokens, and is
  // created automatically when the authorization flow completes for the first
  // time.
  tokenPath: path.join(resourcesPath, 'token.json'),
  credentialsPath: path.join(resourcesPath, 'credentials.json'),

  async get() {
    if (!this.drive) this.drive = await this.authorize().then(this.getDrive)
    return this.drive!
  },

  getDrive(authClient: GoogleClient) {
    let options: drive_v3.Options = { version: 'v3', auth: authClient as GlobalOptions['auth'] }
    return google.drive(options)
  },

  /**
    * Reads previously authorized credentials from the save file.
    */
  async loadSavedCredentialsIfExist() {
    try {
      const content = await fs.readFile(driveProvider.tokenPath);
      const credentials = JSON.parse(content.toString());
      return google.auth.fromJSON(credentials);
    } catch (err) {
      return null;
    }
  },

  /**
    * Serializes credentials to a file comptible with GoogleAUth.fromJSON.
    */
  async saveCredentials(client: JSONClient) {
    const content = await fs.readFile(driveProvider.credentialsPath);
    const keys = JSON.parse(content.toString());
    const key = keys.installed || keys.web;
    const payload = JSON.stringify({
      type: 'authorized_user',
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: client.credentials.refresh_token,
    });
    await fs.writeFile(driveProvider.tokenPath, payload);
  },

  /**
    * Load or request or authorization to call APIs.
    */
  async authorize(): Promise<GoogleClient> {
    let client = await this.loadSavedCredentialsIfExist();
    if (client) {
      return client;
    }
    let newClient = await authenticate({
      scopes: driveProvider.scopes,
      keyfilePath: driveProvider.credentialsPath,
    }) as JSONClient;
    if (newClient.credentials) {
      await this.saveCredentials(newClient);
    }
    return newClient;
  },

}

async function createFolder(folderName: string) {
  const fileMetadata = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [process.env.GOOGLE_FOLDER_ID],
  };

  let drive = await driveProvider.get()
  const file = await drive.files.create({
    resource: fileMetadata,
    fields: 'id, name, webViewLink',
  } as drive_v3.Params$Resource$Files$Create);
  return file;
}

export function createFolders(folderNames: string[], logger: Logger) {
  const promises = folderNames.map(folderName => {
    return createFolder(folderName)
      .then(file => {
        logger.info(t('googleApi.createFolderSuccess', {
          folderName: chalk.bold(file.data.name),
          link: file.data.webViewLink 
        }))
        return file
      })
      .catch(() => {
        const error = new Error(t('googleApi.createFolderError', {
          folderName: chalk.bold(folderName) 
        }))
        logger.error(error)
        throw error
      })
  })
  return Promise.allSettled(promises)
}

/**
 * Lists the names and IDs of up to 10 files.
 */
export async function listFiles(folderId?: string) {
  let drive = await driveProvider.get()
  let params = {
    pageSize: 10,
    fields: 'nextPageToken, files(id, name, createdTime, size, mimeType, fileExtension)',
    q: 'trashed=false',
  } as drive_v3.Params$Resource$Files$List
  if (folderId) params.q += `and '${folderId}' in parents`
  const res = await drive.files.list(params);
  return res.data.files ?? []
}

export async function getFile(fileId: string) {
  let drive = await driveProvider.get()
  const file = await drive.files.get({
    fileId: fileId,
    alt: 'media',
  }, {
    responseType: 'arraybuffer'
  });
  return file.data as ArrayBuffer
}
