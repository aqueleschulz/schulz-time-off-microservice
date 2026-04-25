import { Module, Injectable } from '@nestjs/common';
import { HcmAdapter, IHttpClient } from './HcmAdapter';
import { DI_TOKENS } from '../di/InjectionTokens';

/**
 * Minimalist HTTP Client using Node's native fetch.
 * Implements IHttpClient without relying on heavy external libraries like Axios.
 */
@Injectable()
export class NativeHttpClient implements IHttpClient {
  private readonly baseUrl =
    process.env.HCM_BASE_URL || 'http://localhost:3001';

  public async get(url: string): Promise<{ data: unknown }> {
    const response = await fetch(`${this.baseUrl}${url}`);
    const data = await this.parseResponse(response);
    return { data };
  }

  public async post(
    url: string,
    payload?: unknown,
    config?: { headers?: Record<string, string> },
  ): Promise<{ data: unknown }> {
    const headers = {
      'Content-Type': 'application/json',
      ...(config?.headers || {}),
    };
    const response = await fetch(`${this.baseUrl}${url}`, {
      method: 'POST',
      headers,
      body: payload ? JSON.stringify(payload) : undefined,
    });

    const data = await this.parseResponse(response);
    return { data };
  }

  private async parseResponse(response: Response): Promise<unknown> {
    const isJson = response.headers
      .get('content-type')
      ?.includes('application/json');
    const data: unknown = isJson
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      // Formats the error to match the structure expected by HcmAdapter.analyzeErrorAndRetry
      const errorObj = new Error('HTTP Request Failed');
      Object.assign(errorObj, { response: { status: response.status, data } });
      throw errorObj;
    }

    return data;
  }
}

/**
 * NestJS Module to encapsulate the HCM external integration.
 * It provides the IHcmPort domain token using the HcmAdapter infrastructure implementation.
 */
@Module({
  providers: [
    NativeHttpClient,
    {
      provide: DI_TOKENS.HCM_PORT,
      useFactory: (httpClient: NativeHttpClient) => {
        return new HcmAdapter(httpClient);
      },
      inject: [NativeHttpClient],
    },
  ],
  exports: [DI_TOKENS.HCM_PORT],
})
export class HcmIntegrationModule {}
