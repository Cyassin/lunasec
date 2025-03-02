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
import {
  DeleteMessageCommand,
  GetQueueUrlCommand,
  Message,
  ReceiveMessageCommand,
  ReceiveMessageCommandOutput,
  SQSClient,
} from '@aws-sdk/client-sqs';

import { getAwsConfig, getQueueHandlerConfig } from '../config';
import { handleGenerateManifestSbom } from '../sqs-handlers/generate-sbom';
import { handleScanSbom } from '../sqs-handlers/scan-sbom';
import { S3ObjectMetadata } from '../types/s3';
import { S3SqsEvent } from '../types/sqs';

const awsConfig = getAwsConfig();
const queueHandlerConfig = getQueueHandlerConfig();

const sqsClient: SQSClient = new SQSClient({ region: awsConfig.awsRegion });

type HandlerCallback = (object: S3ObjectMetadata) => Promise<void>;

async function deleteMessage(message: Message, queueUrl: string) {
  const deleteParams = {
    QueueUrl: queueUrl,
    ReceiptHandle: message.ReceiptHandle,
  };
  try {
    const data = await sqsClient.send(new DeleteMessageCommand(deleteParams));
    console.log('Message deleted', data);
  } catch (err) {
    console.log('Error deleting message', err);
  }
}

async function readDataFromQueue(queueUrl: string, processObjectCallback: (object: S3ObjectMetadata) => Promise<void>) {
  try {
    const params = {
      AttributeNames: ['SentTimestamp'],
      MaxNumberOfMessages: 10,
      MessageAttributeNames: ['All'],
      QueueUrl: queueUrl,
      VisibilityTimeout: 60,
      WaitTimeSeconds: 5,
    };

    const data: ReceiveMessageCommandOutput = await sqsClient.send(new ReceiveMessageCommand(params));
    if (data.Messages) {
      await Promise.all(
        data.Messages.map(async (message) => {
          if (!message.Body) {
            console.log('Received sqs message with no message body');
            return;
          }
          const parsedBody = JSON.parse(message.Body) as S3SqsEvent;
          console.log('parsed body as ', parsedBody);

          if (!parsedBody.Records) {
            console.log('No records on sqs event, deleting message, exiting');
            return deleteMessage(message, queueUrl);
          }
          // todo: do we actually need this promise handling or should we only take the first record from any event...assuming one file per object created event makes a lot of sense
          const handlerPromises: Promise<void>[] = parsedBody.Records.map((record) => {
            return processObjectCallback({
              bucketName: record.s3.bucket.name,
              key: record.s3.object.key,
              region: record.awsRegion,
            });
          });
          await Promise.all(handlerPromises);
          void deleteMessage(message, queueUrl);
        })
      );
    }
  } catch (err) {
    console.error('SQS processor top level error: ', err);
  }
}

const handlers: Record<string, HandlerCallback> = {
  'process-manifest-queue': handleGenerateManifestSbom,
  'process-sbom-queue': handleScanSbom,
};

function determineHandler(): HandlerCallback {
  const handlerName = queueHandlerConfig.handlerName;
  if (!(handlerName in handlers)) {
    throw new Error('Unknown queue handler: ' + handlerName);
  }
  return handlers[handlerName];
}

export async function setupQueue() {
  const queueName = queueHandlerConfig.queueName;

  const { QueueUrl } = await sqsClient.send(
    new GetQueueUrlCommand({
      QueueName: queueName,
    })
  );
  if (!QueueUrl) {
    throw new Error('failed to get QueueUrl for queuename ' + queueName);
  }
  console.log('got queueUrl: ', QueueUrl);
  // read loop
  // eslint-disable-next-line no-constant-condition
  while (true) {
    console.log('Checking queue for messages: ', queueName);
    await readDataFromQueue(QueueUrl, determineHandler());
  }
}

void setupQueue();
