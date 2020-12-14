import {XrayOptions, XrayImportOptions} from './processor'
import got, {Got} from 'got'
import * as core from '@actions/core'
import FormData from 'form-data'

export class Xray {
  xrayProtocol = 'https'
  searchParams!: URLSearchParams
  token = ''
  gotClient: Got

  constructor(
    private xrayOptions: XrayOptions,
    private xrayImportOptions: XrayImportOptions
  ) {
    this.gotClient = got.extend({
      responseType: 'json',
      timeout: 30000, // 30s timeout
      retry: 2, // retry count for some requests
      http2: true // try to allow http2 requests
    })
    // xray cloud / server
    if (this.xrayOptions.xrayServer) {
      this.gotClient = this.gotClient.extend({
        prefixUrl: `${this.xrayProtocol}://${this.xrayOptions.xrayBaseUrl}/rest/raven/1.0`,
        username: this.xrayOptions.username,
        password: this.xrayOptions.password
      })
    } else {
      this.gotClient = this.gotClient.extend({
        prefixUrl: `${this.xrayProtocol}://xray.cloud.xpand-it.com/api/v1`
      })
    }
    this.createSearchParams()
  }

  updateTestExecKey(testExecKey: string): void {
    this.xrayImportOptions.testExecKey = testExecKey
    this.createSearchParams()
  }

  createSearchParams(): void {
    // prepare params
    const elements: string[][] = [
      ['projectKey', this.xrayImportOptions.projectKey]
    ]
    if (this.xrayImportOptions.testExecKey) {
      elements.push(['testExecKey', this.xrayImportOptions.testExecKey])
    }
    if (this.xrayImportOptions.testPlanKey) {
      elements.push(['testPlanKey', this.xrayImportOptions.testPlanKey])
    }
    if (this.xrayImportOptions.testEnvironments) {
      elements.push([
        'testEnvironments',
        this.xrayImportOptions.testEnvironments
      ])
    }
    if (this.xrayImportOptions.revision) {
      elements.push(['revision', this.xrayImportOptions.revision])
    }
    if (this.xrayImportOptions.fixVersion) {
      elements.push(['fixVersion', this.xrayImportOptions.fixVersion])
    }
    this.searchParams = new URLSearchParams(elements)
  }

  updateTestExecJson(testExecutionJson: Object): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const testExecJson: any = testExecutionJson
    if (!testExecJson['fields']) {
      testExecJson['fields'] = {}
    }
    if (!testExecJson['fields']['project']) {
      testExecJson['fields']['project'] = {}
    }
    testExecJson['fields']['project']['key'] = this.xrayImportOptions.projectKey

    if (!testExecJson['xrayFields']) {
      testExecJson['xrayFields'] = {}
    }
    if (this.xrayImportOptions.testExecKey) {
      testExecJson['xrayFields'][
        'testExecKey'
      ] = this.xrayImportOptions.testExecKey
    }
    if (this.xrayImportOptions.testPlanKey) {
      testExecJson['xrayFields'][
        'testPlanKey'
      ] = this.xrayImportOptions.testPlanKey
    }
    if (this.xrayImportOptions.testEnvironments) {
      testExecJson['xrayFields'][
        'testEnvironments'
      ] = this.xrayImportOptions.testEnvironments
    }
    if (this.xrayImportOptions.revision) {
      testExecJson['xrayFields']['revision'] = this.xrayImportOptions.revision
    }
    if (this.xrayImportOptions.fixVersion) {
      testExecJson['xrayFields'][
        'fixVersion'
      ] = this.xrayImportOptions.fixVersion
    }
  }

  async auth(): Promise<void> {
    if (this.xrayOptions.xrayServer) {
      // Trying to connect to Jira server to validate auth
      await this.gotClient.get<string>(`/api/2/myself`, {
        prefixUrl: `${this.xrayProtocol}://${this.xrayOptions.xrayBaseUrl}`
      })
    } else {
      const authenticateResponse = await this.gotClient.post<string>(
        `/authenticate`,
        {
          json: {
            client_id: `${this.xrayOptions.username}`,
            client_secret: `${this.xrayOptions.password}`
          }
        }
      )
      const token = authenticateResponse.body
      this.gotClient = this.gotClient.extend({
        headers: {Authorization: `Bearer ${token}`}
      })
      core.setSecret(token)
    }
  }

  async import(data: Buffer): Promise<string> {
    // do import
    let format = this.xrayImportOptions.testFormat
    if (format === 'xray') {
      format = '' // xray format has no subpath
    }

    if (
      this.xrayImportOptions.testExecutionJson &&
      !this.xrayImportOptions.testExecKey
    ) {
      const form = new FormData()
      this.updateTestExecJson(this.xrayImportOptions.testExecutionJson)
      form.append(
        'info',
        JSON.stringify(this.xrayImportOptions.testExecutionJson),
        {
          contentType: 'application/json',
          filename: 'info.json',
          filepath: 'info.json'
        }
      )
      form.append('results', data.toString('utf-8'), {
        contentType: 'text/xml',
        filename: 'test.xml',
        filepath: 'test.xml'
      })
      form.append(
        'testInfo',
        JSON.stringify({
          fields: {
            project: {
              key: this.xrayImportOptions.projectKey
            }
          }
        }),
        {
          contentType: 'application/json',
          filename: 'testInfo.json',
          filepath: 'testInfo.json'
        }
      )

      const endpoint = `/import/execution/${format}/multipart`
      core.debug(
        `Using multipart endpoint: ${this.gotClient.defaults.options.prefixUrl}${endpoint}`
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const importResponse = await this.gotClient.post<any>(endpoint, {
        body: form
      })

      try {
        return importResponse.body.key
      } catch (error) {
        core.warning(
          `🔥 Response did not match expected format: ${JSON.stringify(
            importResponse.body
          )}`
        )
        return ''
      }
    } else {
      const endpoint = `/import/execution/${format}`
      core.debug(
        `Using endpoint: ${this.gotClient.defaults.options.prefixUrl}${endpoint}`
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const importResponse = await this.gotClient.post<any>(endpoint, {
        searchParams: this.searchParams,
        headers: {
          'Content-Type': 'text/xml'
        },
        body: data,
        timeout: 60000 // 60s timeout
      })
      try {
        return importResponse.body.key
      } catch (error) {
        core.warning(
          `🔥 Response did not match expected format: ${JSON.stringify(
            importResponse.body || importResponse
          )}`
        )
        return ''
      }
    }
  }
}
