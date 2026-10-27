import type { MerchantDto, MerchantInput, MethodDto, MethodInput } from '@grids/schema';
import { HttpError } from '../errors.js';
import type { PaymentGateway } from './types.js';

/** GridPay, reached over its private service API (bearer token). Mistakes the person can fix come back as proper API errors. */
export class GridPayClient implements PaymentGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(new URL(path, this.baseUrl), {
      method,
      headers: { authorization: `Bearer ${this.serviceToken}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status >= 400 && res.status < 500) {
      const j = (await res.json().catch(() => ({}))) as { message?: string };
      throw new HttpError(res.status === 401 ? 502 : res.status, res.status === 404 ? 'Not found' : 'Payment request refused', j.message);
    }
    if (!res.ok) throw new Error(`GridPay ${method} ${path}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  merchants(orgId: string) {
    return this.call<MerchantDto[]>('GET', `/internal/orgs/${orgId}/merchants`);
  }
  saveMerchant(orgId: string, merchantId: string | null, input: MerchantInput) {
    return merchantId
      ? this.call<MerchantDto[]>('PUT', `/internal/orgs/${orgId}/merchants/${merchantId}`, input)
      : this.call<MerchantDto[]>('POST', `/internal/orgs/${orgId}/merchants`, input);
  }
  deleteMerchant(orgId: string, merchantId: string) {
    return this.call<MerchantDto[]>('DELETE', `/internal/orgs/${orgId}/merchants/${merchantId}`);
  }
  methods(orgId: string) {
    return this.call<MethodDto[]>('GET', `/internal/orgs/${orgId}/methods`);
  }
  addMethod(orgId: string, input: MethodInput) {
    return this.call<MethodDto[]>('POST', `/internal/orgs/${orgId}/methods`, input);
  }
  changeMethod(orgId: string, key: string, input: MethodInput) {
    return this.call<MethodDto[]>('PUT', `/internal/orgs/${orgId}/methods/${key}`, input);
  }
  deleteMethod(orgId: string, key: string) {
    return this.call<MethodDto[]>('DELETE', `/internal/orgs/${orgId}/methods/${key}`);
  }
  createPayment(p: Parameters<PaymentGateway['createPayment']>[0]) {
    return this.call<{ id: string; checkoutUrl: string }>('POST', '/internal/payments', p);
  }
  payment(id: string) {
    return this.call<Awaited<ReturnType<PaymentGateway['payment']>>>('GET', `/internal/payments/${id}`);
  }
}
