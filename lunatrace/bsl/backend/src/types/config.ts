/*
 * Copyright by LunaSec (owned by Refinery Labs, Inc)
 *
 * Licensed under the Business Source License v1.1
 * (the "License"); you may not use this file except in compliance with the
 * License. You may obtain a copy of the License at
 *
 * https://github.com/lunasec-io/lunasec/blob/master/licenses/BSL-LunaTrace.txt
 *
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */
export interface ServerConfig {
  serverPort: number;
  sitePublicUrl: string;
}

export interface SbomHandlerConfig {
  sbomBucket: string;
  manifestBucket: string;
}

export interface QueueHandlerConfig {
  queueName: string;
  handlerName: string;
}

export interface GithubAppConfig {
  githubAppId: number;
  githubPrivateKey: string;
}

export interface AwsConfig {
  awsRegion: string;
}

export interface HasuraConfig {
  hasuraEndpoint: string;
  staticAccessToken: string;
}
