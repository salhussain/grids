import type { MerchantDto, MerchantInput, MethodDto, MethodInput } from '@grids/schema';

/** What the platform needs from GridPay (the payment service, apps/pay): merchants, and payments taken through them. */
export interface PaymentGateway {
  merchants(orgId: string): Promise<MerchantDto[]>;
  saveMerchant(orgId: string, merchantId: string | null, input: MerchantInput): Promise<MerchantDto[]>;
  deleteMerchant(orgId: string, merchantId: string): Promise<MerchantDto[]>;
  /** The organisation's ways of paying (the defaults are added the first time they are read). */
  methods(orgId: string): Promise<MethodDto[]>;
  addMethod(orgId: string, input: MethodInput): Promise<MethodDto[]>;
  changeMethod(orgId: string, key: string, input: MethodInput): Promise<MethodDto[]>;
  deleteMethod(orgId: string, key: string): Promise<MethodDto[]>;
  /** Opens a payment; the person pays on `checkoutUrl`. */
  createPayment(p: {
    id: string;
    orgId: string;
    projectKey: string;
    formKey: string;
    amount: number;
    currency: string;
    description: string;
    email: string | null;
    returnUrl: string;
    merchantId: string | null;
  }): Promise<{ id: string; checkoutUrl: string }>;
  /** How a payment stands (the authority, when the platform has not yet been told). */
  payment(id: string): Promise<{ id: string; status: 'pending' | 'succeeded' | 'failed' | 'cancelled'; paidAt: string | null }>;
}
