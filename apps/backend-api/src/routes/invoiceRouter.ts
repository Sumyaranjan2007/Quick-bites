/**
 * The customer's invoice for an order.
 *
 * -------------------------------------------------------------------------
 * TWO DOCUMENTS, AND THE DIFFERENCE MATTERS
 * -------------------------------------------------------------------------
 * A RECEIPT says what was paid. It makes no tax claim, needs no registration,
 * and is always available.
 *
 * A TAX INVOICE is a legal document naming a GSTIN, against which the recipient
 * may claim input credit. It cannot be issued until the platform's registration
 * is actually configured, and issuing one with a placeholder would not be a
 * rough draft — it would be a false document handed to somebody who may act on
 * it.
 *
 * So this router serves whichever it honestly can, says which one it served,
 * and never dresses one up as the other. A customer asking what they paid gets
 * an answer either way.
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
import { invoiceFor, taxIdentityGaps } from '../modules/payments/tax.ts';
import { refundForOrder } from '../modules/payments/refunds.ts';
import { toPaise, toRupees } from '../modules/payments/money.ts';

export const invoiceRouter = Router();

/**
 * GET /api/invoices/orders/:orderId
 *
 * The tax invoice where one can be issued, and a plain receipt where it cannot.
 */
invoiceRouter.get('/orders/:orderId', authMiddleware('customer'), async (req, res, next) => {
  try {
    const order = await orderRepository.findById(req.params.orderId);
    if (!order || order.customerId !== req.user!.id) {
      throw new AppError('No such order.', 404, 'ORDER_NOT_FOUND');
    }

    if (order.status !== 'DELIVERED') {
      // An invoice for a supply that has not happened is not a document worth
      // having, and issuing one consumes a number from the GST series for an
      // order that may yet be cancelled.
      throw new AppError(
        'An invoice is available once the order has been delivered.',
        409,
        'ORDER_NOT_DELIVERED'
      );
    }

    if (order.paymentStatus !== 'PAID') {
      throw new AppError(
        'This order has not been paid for yet, so there is nothing to invoice.',
        409,
        'ORDER_NOT_PAID'
      );
    }

    const gaps = taxIdentityGaps();

    if (gaps.length === 0) {
      return res.json({
        success: true,
        data: { kind: 'TAX_INVOICE', invoice: invoiceFor(order) }
      });
    }

    /*
     * A receipt instead.
     *
     * The figures are the order's own and are described as what was charged,
     * never as tax collected under a registration. The customer is told plainly
     * that a tax invoice is not available rather than being shown a document
     * with an empty GSTIN and left to work it out.
     */
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
          'This is a payment receipt, not a tax invoice. A tax invoice will be available once Quick Bites has completed its GST registration details.'
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
