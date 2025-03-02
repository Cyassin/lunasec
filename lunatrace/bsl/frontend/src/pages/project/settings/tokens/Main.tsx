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
import React, { useState } from 'react';
import { Accordion, Button, Col, ListGroup, Row } from 'react-bootstrap';
import { CopyBlock, dracula } from 'react-code-blocks';
import { Plus } from 'react-feather';

import { ConditionallyRender } from '../../../../components/utils/ConditionallyRender';
import { ProjectInfo } from '../../types';

import { CreateTokenForm } from './TokenForm';
import { TokenItem } from './TokenItem';

interface ProjectTokensProps {
  project: ProjectInfo;
}

export const ProjectTokens: React.FC<ProjectTokensProps> = ({ project }) => {
  const [formOpen, setFormOpen] = useState(false);

  return (
    <>
      <Row>
        <Col md="4">
          <h2>Project Secrets</h2>
        </Col>
        <Col md>
          <p>
            Project Secrets can be used by the LunaTrace CLI to directly create builds of the project or one of its
            artifacts. This is typically done from a CI or release job.
          </p>
        </Col>
        <Col>
          <Accordion flush={true}>
            <Accordion.Item eventKey="0">
              <Accordion.Header className="secret-more-info-accordion-header">More info and examples</Accordion.Header>
              <Accordion.Body>
                These tokens are designed to be embedded in a build job, and do not expire. Anyone with this secret can
                create builds of your project to LunaTrace, so keep it secret and do not commit it. Project Secrets can
                only be copied at the time of creation. If you lose the key, you must create a new one. Project secrets
                are passed to the LunaTrace CLI as an environment variable.
                <CopyBlock
                  text={'LUNATRACE_PROJECT_SECRET=<YOUR SECRET> lunatrace inventory create <YOUR ARTIFACT>'}
                  language="bash"
                  showLineNumbers={false}
                  startingLineNumber={false}
                  theme={dracula}
                  codeBlock
                />
                If the project is linked to a repo in GitHub, LunaTrace will attempt to clone the repo and automatically
                perform a scan, which would make it unnecessary to create a token and call the CLI manually, as shown
                above. However, in many cases you may wish to scan a specific artifact such as a zip, jarfile,
                container, or manifest file that is not committed to Git. This is especially useful for languages which
                do not have complete manifest files and need to be scanned after compilation, such as Java, and in cases
                where we want to scan a Docker container.
              </Accordion.Body>
            </Accordion.Item>
          </Accordion>
        </Col>

        <ListGroup>
          {project.project_access_tokens.map((t) => {
            return <TokenItem key={t.id} token={t} />;
          })}
          {formOpen ? <CreateTokenForm project={project} setFormOpen={setFormOpen} /> : null}
        </ListGroup>
      </Row>
      <ConditionallyRender if={!formOpen}>
        <Row className="justify-content-sm-center">
          <Col className="text-right" sm="3">
            <Button variant="success" className="m-2" onClick={() => setFormOpen(true)}>
              <Plus size="1.2em" className="align-middle mb-1 me-2" />
              Create New Secret
            </Button>
          </Col>
        </Row>
      </ConditionallyRender>
      <hr />
    </>
  );
};
