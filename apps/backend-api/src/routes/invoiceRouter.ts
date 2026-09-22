/**
 * The customer's receipt for an order, and what happened to any refund on it.
 *
 * -------------------------------------------------------------------------
 * A RECEIPT, NOT A TAX INVOICE
 * -------------------------------------------------------------------------
 * This says what was paid. It makes no tax claim and names no registration,
 * which is deliberate: the owner handles GST outside this platform, so a
 * document here that called itself a tax invoice would be claiming something
 * nobody here can stand behind.
 *
 * -------------------------------------------------------------------------
 * ONLY YOUR OWN, AND ONLY ONCE IT IS DELIVERED
 * -------------------------------------------------------------------------
 * The order is fetched by id from the path — it has to be — so ownership is
 * checked explicitly, and a stranger's order reads as missing rather than as
 * forbidden. There is no reason for one customer to learn that another
 * customer's order exists.
 */
import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.ts';
import { AppError } from '../utils/AppError.ts';
import { orderRepository } from '../db/repositories/orderRepository.ts';
import { refundForOrder } from '../modules/payments/refunds.ts';
import { toPaise, toRupees } from '../modules/payments/money.ts';

export const invoiceRouter = Router();

/**
 * GET /api/invoices/orders/:orderId
 *
 * What they paid, line by line.
 */
invoiceRouter.get('/orders/:orderId', authMiddleware('customer'), async (req, res, next) => {
  try {
    const order = await orderRepository.findById(req.params.orderId);
    if (!order || order.customerId !== req.user!.id) {
      throw new AppError('No such order.', 404, 'ORDER_NOT_FOUND');
    }

    if (order.status !== 'DELIVERED') {
      // A receipt for a delivery that has not happened is not a document worth
      // having, and the order may yet be cancelled.
      throw new AppError(
        'Your receipt is available once the order has been delivered.',
        409,
        'ORDER_NOT_DELIVERED'
      );
    }

    if (order.paymentStatus !== 'PAID') {
      throw new AppError(
        'This order has not been paid for yet, so there is nothing to receipt.',
        409,
        'ORDER_NOT_PAID'
      );
    }

    const bill: any = order.bill || {};
    res.json({
      success: true,
      data: {
        kind: 'RECEIPT',
        receipt: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          date: order.deliveredAt || order.createdAt,
          restaurantName: order.restaurantName,
          deliveryAddress: order.deliveryAddressText || '',
          lines: [
            { label: 'Food', amount: Number(bill.itemsTotal) || 0 },
            { label: 'Packaging', amount: Number(bill.packagingFee) || 0 },
            { label: 'Delivery', amount: Number(bill.deliveryFee) || 0 },
            { label: 'Taxes', amount: Number(bill.gstAmount) || 0 },
            { label: 'Platform fee', amount: Number(bill.platformFee) || 0 },
            ...(Number(bill.couponDiscount) ? [{ label: 'Discount', amount: -Number(bill.couponDiscount) }] : []),
            ...(Number(bill.tipAmount) ? [{ label: 'Tip to your delivery partner', amount: Number(bill.tipAmount) }] : [])
          ],
          total: toRupees(toPaise(Number(bill.totalAmount) || 0)),
          paidBy: order.paymentMethod
        },
        /** Said out loud rather than left as a blank field on a form. */
        message:
          'This is your payment receipt for this order.'
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/invoices/orders/:orderId/refund
 *
 * What happened to a refund on this order, in the customer's own terms: how
 * much, by which route, and how long their bank will take.
 *
 * Read from the ledger rather than from a status field on the order. A status
 * column has to be kept in step by whoever moved the money, and the one time
 * somebody forgets is the time a customer is refreshing the screen. The ledger
 * already records every refund that was actually paid.
 *
 * It returns `null` rather than an error when there is no refund. A customer
 * checking an order that was fine is asking a reasonable question and should
 * not be shown a failure for it.
 */
invoiceRouter.get('/orders/:orderId/refund', authMiddleware('customer'), async (req, res, next) => {
  try {
    const order = await orderRepository.findById(req.params.orderId);
    if (!order || order.customerId !== req.user!.id) {
      throw new AppError('No such order.', 404, 'ORDER_NOT_FOUND');
    }

    res.json({ success: true, data: { refund: refundForOrder(order) } });
  } catch (err) {
    next(err);
  }
});
