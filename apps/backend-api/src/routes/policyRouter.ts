/**
 * The payment policies, served to anybody who asks.
 *
 * -------------------------------------------------------------------------
 * DELIBERATELY UNAUTHENTICATED
 * -------------------------------------------------------------------------
 * A refund policy that can only be read by somebody who has already signed up
 * and ordered is not a published policy. These are the terms a person is
 * deciding whether to accept — a customer before they pay, a restaurant before
 * they sign, a rider before they ride — and every one of them is entitled to
 * read them first.
 *
 * There is nothing private here. The audience filter shapes what is USEFUL to
 * show in a given app; it is not a permission, and asking for another
 * audience's list returns it.
 */
import { Router } from 'express';
import {
  businessIdentity,
  formattedAddress,
  officialFooter
} from '../modules/platform/businessIdentity.ts';
import { AppError } from '../utils/AppError.ts';
import {
  paymentPolicies,
  policiesFor,
  findPaymentPolicy,
  policyGaps,
  getGrievanceContact,
  type PolicyAudience
} from '../modules/payments/paymentPolicies.ts';

export const policyRouter = Router();

const AUDIENCES: PolicyAudience[] = ['customer', 'partner', 'rider', 'public'];

/**
 * GET /api/policies/payments?audience=customer
 *
 * Titles and summaries. The body of each comes from the route below, so a list
 * screen does not download six documents to render six headings.
 */
policyRouter.get('/payments', (req, res) => {
  const requested = String(req.query.audience || '').toLowerCase() as PolicyAudience;
  const list = AUDIENCES.includes(requested) ? policiesFor(requested) : paymentPolicies();

  res.json({
    success: true,
    data: {
      policies: list.map(({ id, title, summary, updatedAt, audiences }) => ({
        id,
        title,
        summary,
        updatedAt,
        audiences
      })),
      /**
       * What is not published yet.
       *
       * Returned to everybody, not only to administrators. A customer reading a
       * policy is entitled to know that the formal escalation route in it is
       * incomplete — hiding that would make the document look more finished
       * than it is, which is the opposite of what a policy is for.
       */
      gaps: policyGaps(),
      grievanceOfficerPublished: Boolean(getGrievanceContact())
    }
  });
});

/** GET /api/policies/payments/:id — one policy in full. */
policyRouter.get('/payments/:id', (req, res, next) => {
  try {
    const policy = findPaymentPolicy(req.params.id);
    if (!policy) throw new AppError('No such policy.', 404, 'POLICY_NOT_FOUND');
    res.json({ success: true, data: { policy } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/policies/business — who this platform legally is.
 *
 * Unauthenticated on purpose, like the policies beside it. A customer deciding
 * whether to trust a new food app, or a partner deciding whether to sign up,
 * should not have to create an account first to find out who they would be
 * dealing with. All of it is public record: a Udyam number can be verified by
 * anyone on the government portal, and the contact details are the ones
 * printed on receipts.
 */
policyRouter.get('/business', async (_req, res, next) => {
  try {
    const identity = businessIdentity();
    res.json({
      success: true,
      data: {
        identity,
        formattedAddress: formattedAddress(identity),
        /** Ready-to-render lines, so four apps cannot format it four ways. */
        footer: officialFooter(identity)
      }
    });
  } catch (err) {
    next(err);
  }
});
