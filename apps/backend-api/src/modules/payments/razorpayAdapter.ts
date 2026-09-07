import crypto from 'crypto';
import { config } from '../../config/env.ts';

export interface CreatePaymentParams {
  amountInPaise: number;
  orderNumber: string;
}

export interface VerifySignatureParams {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

export const razorpayAdapter = {
  createOrder(params: CreatePaymentParams) {
    const razorpayOrderId = 'order_rzp_mock_' + crypto.randomUUID().replace(/-/g, '').substring(0, 14);
    return {
      id: razorpayOrderId,
      amount: params.amountInPaise,
      currency: 'INR',
      receipt: params.orderNumber,
      keyId: config.RAZORPAY_KEY_ID
    };
  },

  verifySignature(params: VerifySignatureParams): boolean {
    if (config.DEMO_MODE && config.NODE_ENV !== 'production') {
      // In Demo/Dev Mode only, permit simulated test signatures
      if (params.razorpaySignature.startsWith('sig_test_') || params.razorpaySignature === 'simulated_valid_signature') {
        return true;
      }
    }

    const payload = params.razorpayOrderId + '|' + params.razorpayPaymentId;
    const expected = crypto
      .createHmac('sha256', config.RAZORPAY_KEY_SECRET)
      .update(payload)
      .digest('hex');

    const expectedBuffer = Buffer.from(expected);
    const signatureBuffer = Buffer.from(params.razorpaySignature);

    if (expectedBuffer.length !== signatureBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
  },

  generateSimulatedSignature(razorpayOrderId: string, razorpayPaymentId: string): string {
    const payload = razorpayOrderId + '|' + razorpayPaymentId;
    return crypto
      .createHmac('sha256', config.RAZORPAY_KEY_SECRET)
      .update(payload)
      .digest('hex');
  }
};
