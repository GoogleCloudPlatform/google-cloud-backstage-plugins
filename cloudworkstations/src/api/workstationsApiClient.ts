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

import { WorkstationConfig } from '../components/types';
import { IAM_WORKSTATIONS_PERMISSION, Workstation } from './types';
import { CloudWorkstationsApi } from './workstationsApi';
import { ErrorApi, FetchApi, OAuthApi } from '@backstage/core-plugin-api';

export const GCP_CLOUDWORKSTATIONS_API_URL =
  'https://workstations.googleapis.com/v1';

export const GCP_CLOUDWORKSTATIONS_CONFIG_ANNOTATION_PATTERN =
  '^projects/[a-z0-9-]+/locations/[a-z0-9-]+/workstationClusters/[a-zA-Z0-9-]+/workstationConfigs/[a-zA-Z0-9-]+$';

const WORKSTATION_CONFIG_REGEX = new RegExp(
  GCP_CLOUDWORKSTATIONS_CONFIG_ANNOTATION_PATTERN,
);

const WORKSTATION_NAME_REGEX = /^[a-zA-Z0-9-]+$/;

const FORBIDDEN_ANNOTATION_SUBSTRINGS = ['?', '#', '..', '@', '%'];

/** @public */
export class WorkstationsApiClient implements CloudWorkstationsApi {
  private readonly IAM_PERMISSIONS_GRANTS = Object.values(
    IAM_WORKSTATIONS_PERMISSION,
  );

  validWorkstationsConfigString(configString: string) {
    if (typeof configString !== 'string') {
      return false;
    }
    if (
      FORBIDDEN_ANNOTATION_SUBSTRINGS.some(substring =>
        configString.includes(substring),
      )
    ) {
      return false;
    }
    return WORKSTATION_CONFIG_REGEX.test(configString);
  }

  constructor(
    private readonly fetchApi: FetchApi,
    private readonly googleAuthApi: OAuthApi,
    private readonly errorApi: ErrorApi,
  ) {}

  private buildWorkstationsUrl(
    workstationConfig: string,
    options?: {
      suffix?: string;
      workstationName?: string;
      queryParams?: Record<string, string>;
    },
  ): string {
    if (!this.validWorkstationsConfigString(workstationConfig)) {
      throw new Error(
        `Invalid workstations config entity annotation value: ${workstationConfig}. Expected value pattern: ${GCP_CLOUDWORKSTATIONS_CONFIG_ANNOTATION_PATTERN}`,
      );
    }

    const segments = workstationConfig.split('/').map(encodeURIComponent);

    if (options?.workstationName !== undefined) {
      const workstationName = options.workstationName;
      if (
        typeof workstationName !== 'string' ||
        FORBIDDEN_ANNOTATION_SUBSTRINGS.some(substring =>
          workstationName.includes(substring),
        ) ||
        !WORKSTATION_NAME_REGEX.test(workstationName)
      ) {
        throw new Error(`Invalid workstation name: ${workstationName}`);
      }
      segments.push('workstations', encodeURIComponent(workstationName));
    }

    const url = new URL(GCP_CLOUDWORKSTATIONS_API_URL);
    const basePath = url.pathname.replace(/\/+$/, '');
    const suffix = options?.suffix ?? '';
    url.pathname = `${basePath}/${segments.join('/')}${suffix}`;

    if (options?.queryParams) {
      for (const [key, value] of Object.entries(options.queryParams)) {
        url.searchParams.set(key, value);
      }
    }

    return url.toString();
  }

  async getWorkstationsIAmPermissions(workstationConfig: string) {
    const url = this.buildWorkstationsUrl(workstationConfig, {
      suffix: ':testIamPermissions',
    });
    const response = await this.handleCloudWorkstationsApiCallResponse(
      this.fetchApi.fetch(url, {
        mode: 'cors',
        headers: await this.getHeaders(),
        method: 'POST',
        body: JSON.stringify({
          permissions: this.IAM_PERMISSIONS_GRANTS,
        }),
      }),
    );
    return (response as Record<string, any>)
      ?.permissions as IAM_WORKSTATIONS_PERMISSION[];
  }

  async getWorkstationConfigDetails(
    workstationConfig: string,
  ): Promise<WorkstationConfig> {
    const url = this.buildWorkstationsUrl(workstationConfig);
    return (await this.handleCloudWorkstationsApiCallResponse(
      this.fetchApi.fetch(url, {
        mode: 'cors',
        headers: await this.getHeaders(),
      }),
    )) as WorkstationConfig;
  }

  async getWorkstations(workstationConfig: string): Promise<Workstation[]> {
    const url = this.buildWorkstationsUrl(workstationConfig, {
      suffix: '/workstations:listUsable',
    });
    const response = await this.handleCloudWorkstationsApiCallResponse(
      this.fetchApi.fetch(url, {
        mode: 'cors',
        headers: await this.getHeaders(),
      }),
    );

    return (response as Record<string, any>)?.workstations;
  }

  async createWorkstation(workstationConfig: string): Promise<void> {
    const url = this.buildWorkstationsUrl(workstationConfig, {
      suffix: '/workstations',
      queryParams: {
        workstationId: `workstation-${Date.now().toString()}`,
      },
    });
    await this.handleCloudWorkstationsApiCallResponse(
      this.fetchApi.fetch(url, {
        mode: 'cors',
        method: 'POST',
        headers: await this.getHeaders(),
      }),
    );
  }

  async startWorkstation(
    workstationConfig: string,
    workstationName: string,
  ): Promise<void> {
    const url = this.buildWorkstationsUrl(workstationConfig, {
      workstationName,
      suffix: ':start',
    });
    await this.handleCloudWorkstationsApiCallResponse(
      this.fetchApi.fetch(url, {
        mode: 'cors',
        method: 'POST',
        headers: await this.getHeaders(),
      }),
    );
  }

  async stopWorkstation(
    workstationConfig: string,
    workstationName: string,
  ): Promise<void> {
    const url = this.buildWorkstationsUrl(workstationConfig, {
      workstationName,
      suffix: ':stop',
    });
    await this.handleCloudWorkstationsApiCallResponse(
      this.fetchApi.fetch(url, {
        mode: 'cors',
        method: 'POST',
        headers: await this.getHeaders(),
      }),
    );
  }

  async getHeaders(): Promise<HeadersInit> {
    const token = await this.googleAuthApi.getAccessToken(
      'https://www.googleapis.com/auth/cloud-platform',
    );
    return {
      Authorization: `Bearer ${token}`,
    };
  }

  private async handleCloudWorkstationsApiCallResponse(
    fetchResult: Promise<Response>,
  ): Promise<Record<string, any> | any[] | undefined> {
    const response = await fetchResult;
    const responseContent = await response?.json();
    if (!response?.ok) {
      if (responseContent?.error) {
        this.errorApi.post({
          name: 'google_cloud_api_response_error',
          message: responseContent.error.message,
        });
      }
    }
    return responseContent;
  }
}
