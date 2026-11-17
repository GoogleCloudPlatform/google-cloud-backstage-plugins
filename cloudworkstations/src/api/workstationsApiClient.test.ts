/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */ 

import { IAM_WORKSTATIONS_PERMISSION } from './types';
import {
  GCP_CLOUDWORKSTATIONS_API_URL,
  WorkstationsApiClient,
} from './workstationsApiClient';

import { http, HttpResponse } from 'msw';
import { setupRequestMockHandlers } from '@backstage/backend-test-utils';
import { setupServer } from 'msw/node';

describe('GCP CloudWorkstations API Client', () => {
  const worker = setupServer();
  setupRequestMockHandlers(worker);

  const fetchApiMock = {
    fetch: jest.fn(),
  };
  const googleOAuthApiMock = {
    getAccessToken: jest.fn(() => Promise.resolve('token')),
  };
  const errorApiMock = { post: jest.fn(), error$: jest.fn() };

  Date.now = () => 100000;

  const workstationsConfigString =
    'projects/analog-object-410617/locations/us-east1/workstationClusters/cluster-lr603ul5/workstationConfigs/config-lr6tst42';

  const client = new WorkstationsApiClient(
    fetchApiMock,
    googleOAuthApiMock,
    errorApiMock,
  );

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should detect invalid workstations config string', () => {
    const testValues = [
      'test/hasdf/impl/test',
      'projects',
      'projects//locations/us-east1/workstationClusters/cluster-lr603ul5/workstationConfigs/config-lr6tst42',
      'projects/analog-object-410617/locations//workstationClusters/cluster-lr603ul5/workstationConfigs/config-lr6tst42',
      'projects/analog-object-410617/locations/us-east1/workstationClusters//workstationConfigs/config-lr6tst42',
      'projects/analog-object-410617/locations/us-east1/workstationClusters/cluster-lr603ul5/workstationConfigs/',
      'projects/p/locations/l/workstationClusters/c/workstationConfigs/x#',
      'projects/p/locations/l/workstationClusters/c/workstationConfigs/x?foo=bar',
      'projects/p/locations/l/workstationClusters/c/workstationConfigs/x&foo=bar',
      'projects/p/locations/l/workstationClusters/c/workstationConfigs/x/extra',
      'projects/p/locations/l/workstationClusters/c/workstationConfigs/x/../../../../../../../../../v1/projects/victim/locations/l/workstationClusters/c/workstationConfigs/cfg/workstations/ws:stop?',
      'projects/p/locations/l/workstationClusters/c/workstationConfigs/x:testIamPermissions',
      'projects/p/locations/l/workstationClusters/c/workstationConfigs/x\n',
      'projects/p?a=1/locations/l/workstationClusters/c/workstationConfigs/x',
      'projects/p#frag/locations/l/workstationClusters/c/workstationConfigs/x',
      'projects/../locations/l/workstationClusters/c/workstationConfigs/x',
      'projects/p@evil/locations/l/workstationClusters/c/workstationConfigs/x',
      'projects/p%2f../locations/l/workstationClusters/c/workstationConfigs/x',
      'projects/p/locations/l/workstationClusters/c%23/workstationConfigs/x',
      'projects/p/locations/l/workstationClusters/c/workstationConfigs/x%3F',
      'projects/P/locations/l/workstationClusters/c/workstationConfigs/x',
      'projects/p/locations/US-EAST1/workstationClusters/c/workstationConfigs/x',
      'prefix/projects/p/locations/l/workstationClusters/c/workstationConfigs/x',
    ];
    for (const testValue of testValues) {
      expect(client.validWorkstationsConfigString(testValue)).toBeFalsy();
    }
  });

  it('should detect valid workstations config string', () => {
    expect(
      client.validWorkstationsConfigString(workstationsConfigString),
    ).toBeTruthy();
    expect(
      client.validWorkstationsConfigString(
        'projects/p-1/locations/us-east1/workstationClusters/Cluster-1/workstationConfigs/Config-2',
      ),
    ).toBeTruthy();
  });

  it('should reject invalid workstation configs and names before calling fetch or auth', async () => {
    const invalidConfigs = [
      'projects/p/locations/l/workstationClusters/c/workstationConfigs/x#',
      'projects/p/locations/l/workstationClusters/c/workstationConfigs/x/../../../../v1/projects/victim/locations/l/workstationClusters/c/workstationConfigs/cfg/workstations/ws:stop?',
      'projects/p/locations/l/workstationClusters/c/workstationConfigs/x?a=b',
      'projects/p@evil/locations/l/workstationClusters/c/workstationConfigs/x',
      'projects/p/locations/l/workstationClusters/c/workstationConfigs/x%2f..',
    ];

    for (const invalidConfig of invalidConfigs) {
      await expect(
        client.getWorkstationsIAmPermissions(invalidConfig),
      ).rejects.toThrow();
      await expect(
        client.getWorkstationConfigDetails(invalidConfig),
      ).rejects.toThrow();
      await expect(client.getWorkstations(invalidConfig)).rejects.toThrow();
      await expect(client.createWorkstation(invalidConfig)).rejects.toThrow();
      await expect(
        client.startWorkstation(invalidConfig, 'testname'),
      ).rejects.toThrow();
      await expect(
        client.stopWorkstation(invalidConfig, 'testname'),
      ).rejects.toThrow();
    }

    const invalidNames = [
      '',
      '../ws',
      'ws#frag',
      'ws?a=1',
      'ws@evil',
      'ws%2f..',
      'ws:stop',
    ];

    for (const invalidName of invalidNames) {
      await expect(
        client.startWorkstation(workstationsConfigString, invalidName),
      ).rejects.toThrow();
      await expect(
        client.stopWorkstation(workstationsConfigString, invalidName),
      ).rejects.toThrow();
    }

    expect(fetchApiMock.fetch).not.toHaveBeenCalled();
    expect(googleOAuthApiMock.getAccessToken).not.toHaveBeenCalled();
  });

  it('should call valid google cloud workstations iam granted permissions retrieval endpoint', async () => {
    expect.assertions(3);
    const iamPermissions = Object.values(IAM_WORKSTATIONS_PERMISSION);
    worker.use(
      http.post(
        `${GCP_CLOUDWORKSTATIONS_API_URL}/${workstationsConfigString}:testIamPermissions`,
        async ({ request }) => {
          expect(request.headers.get('Authorization')).toBe(`Bearer token`);
          expect(request.mode).toBe('cors');
          await expect(request.json()).resolves.toEqual({
            permissions: Object.values(IAM_WORKSTATIONS_PERMISSION),
          });
          return HttpResponse.json(iamPermissions, { status: 200 });
        },
      ),
    );
    await client.getWorkstationsIAmPermissions(workstationsConfigString);
  });

  it('should call valid google cloud workstations config details retrieval endpoint', async () => {
    expect.assertions(2);
    worker.use(
      http.get(
        `${GCP_CLOUDWORKSTATIONS_API_URL}/${workstationsConfigString}`,
        async ({ request }) => {
          expect(request.headers.get('Authorization')).toBe(`Bearer token`);
          expect(request.mode).toBe('cors');
          return HttpResponse.json(
            {
              container: {
                image: 'test-container/image',
              },
              host: {
                gceInstance: {
                  machineType: 'vm-instance',
                },
              },
              persistentDirectories: [
                {
                  gcePd: {
                    diskType: 'standard',
                    fsType: 'ext4',
                    sizeGb: 200,
                  },
                },
              ],
            },
            { status: 200 },
          );
        },
      ),
    );
    await client.getWorkstationConfigDetails(workstationsConfigString);
  });

  it('should call valid google cloud workstations api list usable endpoint', async () => {
    expect.assertions(2);
    worker.use(
      http.get(
        `${GCP_CLOUDWORKSTATIONS_API_URL}/${workstationsConfigString}/workstations:listUsable`,
        async ({ request }) => {
          expect(request.headers.get('Authorization')).toBe(`Bearer token`);
          expect(request.mode).toBe('cors');
          return HttpResponse.json(
            [
              {
                name: 'workstation-1',
                uid: 'workstation-1',
                host: 'workstation-lr6w8c3q.cluster-qttyg5he7nfaaw7m7zxlqico7q.cloudworkstations.dev',
                state: 'STATE_RUNNING',
              },
            ],
            { status: 200 },
          );
        },
      ),
    );
    await client.getWorkstations(workstationsConfigString);
  });

  it('should call valid google cloud workstations api create endpoint', async () => {
    expect.assertions(2);
    worker.use(
      http.post(
        `${GCP_CLOUDWORKSTATIONS_API_URL}/${workstationsConfigString}/workstations?workstationId=workstation-${Date.now()}`,
        async ({ request }) => {
          expect(request.headers.get('Authorization')).toBe(`Bearer token`);
          expect(request.mode).toBe('cors');
          return HttpResponse.json({}, { status: 201 });
        },
      ),
    );
    await client.createWorkstation(workstationsConfigString);
  });

  it('should call valid google cloud workstations api start endpoint', async () => {
    expect.assertions(2);
    worker.use(
      http.post(
        `${GCP_CLOUDWORKSTATIONS_API_URL}/${workstationsConfigString}/workstations/testname:start`,
        async ({ request }) => {
          expect(request.headers.get('Authorization')).toBe(`Bearer token`);
          expect(request.mode).toBe('cors');
          return HttpResponse.json({}, { status: 200 });
        },
      ),
    );
    await client.startWorkstation(workstationsConfigString, 'testname');
  });

  it('should call valid google cloud workstations api stop endpoint', async () => {
    expect.assertions(2);
    worker.use(
      http.post(
        `${GCP_CLOUDWORKSTATIONS_API_URL}/${workstationsConfigString}/workstations/testname:stop`,
        async ({ request }) => {
          expect(request.headers.get('Authorization')).toBe(`Bearer token`);
          expect(request.mode).toBe('cors');
          return HttpResponse.json({}, { status: 200 });
        },
      ),
    );
    await client.stopWorkstation(workstationsConfigString, 'testname');
  });

  it('should log google cloud workstations api error response', async () => {
    expect.assertions(1);

    worker.use(
      http.post(
        `${GCP_CLOUDWORKSTATIONS_API_URL}/${workstationsConfigString}/workstations/testname:stop`,
        async () => {
          return HttpResponse.json({
            error: { message: 'google apis response error' },
          });
        },
      ),
    );

    await client.stopWorkstation(workstationsConfigString, 'test');

    expect(errorApiMock.post).toHaveBeenNthCalledWith(1, {
      name: 'google_cloud_api_response_error',
      message: 'google apis response error',
    });
  });
});
