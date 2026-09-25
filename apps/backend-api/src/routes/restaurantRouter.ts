import { Router } from 'express';
import { z } from 'zod';
import type { Restaurant } from '@quick-bites/shared-types';
import { restaurantRepository } from '../db/repositories/restaurantRepository.ts';
import { menuRepository } from '../db/repositories/menuRepository.ts';
import { menuRequestRepository } from '../db/repositories/menuRequestRepository.ts';
import { orderRepository } from '../db/repositories/orderRepository.ts';
import { settlementRepository } from '../db/repositories/settlementRepository.ts';
import { calculateDistanceKm, memoryStore } from '../db/client.ts';
import { config } from '../config/env.ts';
import { estimateByRoad } from '../modules/places/routingService.ts';
import { hasRealLocation } from '../modules/restaurants/restaurantLocation.ts';
import { emitKitchenStatus, emitMenuUpdated, emitMenuRequestSubmitted } from '../sockets/socketServer.ts';
import { authMiddleware } from '../middlewares/auth.ts';
import { validate } from '../middlewares/validate.ts';
import { AppError } from '../utils/AppError.ts';
import { buildRestaurantDashboard } from '../modules/restaurants/restaurantInsights.ts';
import {
  buildDocumentOverview,
  RESTAURANT_DOCUMENT_TYPES,
  ACCEPTED_FORMATS,
  MAX_UPLOAD_MB
} from '../modules/restaurants/restaurantDocuments.ts';
import { kycRepository } from '../db/repositories/kycRepository.ts';
import { profileEditRepository } from '../db/repositories/profileEditRepository.ts';
import { notifyAdminsMenuRequestRaised, notifyAdminsProfileEditRaised } from '../notifications/adminNotifier.ts';
import { couponRepository } from '../db/repositories/couponRepository.ts';
import { inflateMenuForCustomer } from '../modules/payments/restaurantCharges.ts';
import { bestOfferFor, platformPromotion } from '../modules/restaurants/restaurantOffers.ts';
import {
  buildImagery,
  placeholderColour,
  placeholderInitials
} from '../modules/restaurants/restaurantImagery.ts';
import {
  DAYS_OF_WEEK,
  MAX_WINDOWS_PER_DAY,
  formatTimeOfDay,
  isKitchenServing,
  isWithinOpeningHours,
  nextOpensAt,
  nextClosesAt
} from '../modules/restaurants/openingHours.ts';
import {
  EDITABLE_PROFILE_FIELDS,
  MAX_CUISINE_TAGS,
  MAX_DESCRIPTION_CHARS,
  MAX_GALLERY_IMAGES,
  MAX_IMAGE_CHARS,
  MAX_NAME_CHARS,
  diffProfile,
  readEditableProfile,
  validateProfileChanges
} from '../modules/restaurants/profileEdits.ts';
import { shapeOrderForViewer } from '../modules/orders/contactVisibility.ts';
import { statementFor } from '../modules/payments/statements.ts';
import { listPayouts } from '../modules/payments/payouts.ts';
import { toRupees } from '../modules/payments/money.ts';
import { notifyAdminsKycSubmitted } from '../notifications/adminNotifier.ts';

export const restaurantRouter = Router();

/**
 * GET /api/restaurants — the discovery feed, filtered and sorted.
 *
 * Every filter is applied here rather than in the app. The feed can run to
 * hundreds of kitchens, and filtering client-side means shipping all of them to
 * a phone on mobile data to throw most away — and it means three apps
 * re-implementing the same rules and disagreeing about them.
 *
 * Filters are ANDed. An unrecognised or unparseable value is ignored rather
 * than erroring: a discovery feed that returns 400 because a stale app sent
 * `minRating=good` shows a customer an empty home screen, which is a worse
 * failure than quietly showing them everything.
 */
const SORTS = ['relevance', 'rating', 'deliveryTime', 'costLowToHigh', 'costHighToLow', 'distance'] as const;
type FeedSort = (typeof SORTS)[number];

function numberParam(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

restaurantRouter.get('/', async (req, res) => {
  try {
    const lat = numberParam(req.query.lat);
    const lng = numberParam(req.query.lng);
    const isPureVeg = req.query.isPureVeg === 'true';
    const openNow = req.query.openNow === 'true';
    const minRating = numberParam(req.query.minRating);
    const maxDeliveryMinutes = numberParam(req.query.maxDeliveryMinutes);
    const maxCostForTwo = numberParam(req.query.maxCostForTwo);
    const minCostForTwo = numberParam(req.query.minCostForTwo);
    const cuisine = typeof req.query.cuisine === 'string' ? req.query.cuisine.trim().toLowerCase() : '';
    const query = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const sort: FeedSort = SORTS.includes(req.query.sort as FeedSort)
      ? (req.query.sort as FeedSort)
      : 'relevance';

    const list = await restaurantRepository.listActive();

    /*
     * Offers are read once for the whole feed, not per restaurant.
     *
     * The badge on each card used to be the string "50% OFF", typed into the
     * app and rendered on every kitchen whether or not any such coupon existed.
     * It is now derived from a coupon that is live and would actually apply -
     * and where there is none, the card carries no badge at all.
     *
     * Omitted rather than guessed, the same rule the delivery estimate above
     * already follows. A discount advertised on the card and refused at
     * checkout is a false price claim, which is worse than a wrong estimate:
     * the customer chose that restaurant because of it.
     */
    const coupons = await couponRepository.list();

    /*
     * Menus, for the photographs in them.
     *
     * Almost every card in this feed was a grey rectangle: `bannerUrl` was
     * display-only, no screen in the partner app could set it, so almost no
     * restaurant had one. A feed of grey rectangles looks broken beside every
     * other food app on the phone.
     *
     * A restaurant that has not photographed its premises has almost always
     * photographed its FOOD, for its own menu. That is shown instead - its own
     * food, not a stock photo of somebody else's, which would be a small lie
     * told exactly when a customer is deciding where to spend money.
     */
    const menus = memoryStore.menus;

    // Distance and delivery time exist only when the customer has told us where
    // they are. They used to be manufactured when they had not: `distanceKm`
    // defaulted to 2.5, which fed `15 + distanceKm * 4` and made EVERY
    // restaurant on the home screen read "25 mins" — the fixed delivery time
    // that looked like a hardcoded constant and was in fact a hardcoded input.
    //
    // Undefined is now the honest answer, and the app shows "Set your location"
    // rather than a number nobody computed.
    const origin = lat !== undefined && lng !== undefined ? { latitude: lat, longitude: lng } : null;

    /*
     * Photographs, and what to draw when there are none.
     *
     * The placeholder's colour and initials come from the SERVER so that one
     * restaurant looks the same on every phone and on every screen. A
     * placeholder that differs between the feed and the restaurant's own page
     * reads as a loading bug, and four apps each inventing a palette is how
     * that happens.
     */
    const imageryFor = (r: Restaurant) => {
      const imagery = buildImagery(r as any, menus.get(r.id));
      return {
        photos: imagery.photos,
        photoSource: imagery.source,
        placeholder: {
          initials: placeholderInitials(r.name),
          colour: placeholderColour(r.id)
        }
      };
    };

    /*
     * Whether this kitchen is serving, and when it opens again if not.
     *
     * `isOpen` alone was what the apps read, and it is only a third of the
     * answer now: the partner's switch, their unexpired late-night override
     * and their declared hours all have a say, in that order.
     */
    const servingFor = (r: Restaurant) => ({
      isServing: isKitchenServing(r as any),
      opensAt: nextOpensAt((r as any).openingHours)
    });

    let annotated = list.map((r: Restaurant) => {
      // A restaurant whose position was never set is not measured and not
      // excluded. Judging it by distance would place every pre-map restaurant
      // in Cubbon Park and empty the home screen for the people it actually
      // delivers to — see modules/restaurants/restaurantLocation.ts.
      if (!origin || !hasRealLocation(r)) {
        return {
          ...r,
          distanceKm: undefined,
          isWithinServiceArea: true,
          locationPending: !hasRealLocation(r),
          estimatedDeliveryMinutes: undefined,
          offer: bestOfferFor(r, coupons),
          ...imageryFor(r),
          ...servingFor(r)
        };
      }

      // Whether this kitchen delivers here is a question about a circle on a
      // map, so it is asked of the straight line. What the customer is TOLD is
      // the road estimate, because that is the journey their food makes.
      const straightLine = calculateDistanceKm(
        lat!,
        lng!,
        r.coordinates.latitude,
        r.coordinates.longitude
      );
      const road = estimateByRoad(origin, r.coordinates);
      const serviceRadius = Number(r.serviceRadiusKm) || config.DEFAULT_SERVICE_RADIUS_KM;

      return {
        ...r,
        distanceKm: road.distanceKm,
        // Each restaurant against its own delivery area, not one platform-wide
        // 10 km circle: a kitchen with one rider covers two kilometres and a
        // chain covers eight, and pretending otherwise promised deliveries that
        // would be declined.
        isWithinServiceArea: straightLine <= serviceRadius,
        locationPending: false,
        // Prep plus travel at the configured speed, both settable without a
        // release, instead of a slope invented in this line.
        estimatedDeliveryMinutes: Math.round(
          config.DEFAULT_PREP_MINUTES + (road.distanceKm / config.DELIVERY_SPEED_KMPH) * 60
        ),
        offer: bestOfferFor(r, coupons),
        ...imageryFor(r),
        ...servingFor(r)
      };
    });

    // Out-of-area kitchens are dropped once we know where the customer is.
    // Keeping them was the old behaviour and it showed people restaurants that
    // could not deliver to them.
    if (origin) annotated = annotated.filter(r => r.isWithinServiceArea);

    if (isPureVeg) annotated = annotated.filter(r => r.isPureVeg);
    // `isOpen !== false` rather than `isOpen === true`, so a kitchen recorded
    // before the flag existed is treated as open rather than hidden.
    // Declared hours count here too, so "Open now" does not list a kitchen
    // whose schedule closed an hour ago and whose partner has not noticed.
    if (openNow) annotated = annotated.filter(r => isKitchenServing(r));
    if (minRating !== undefined) {
      annotated = annotated.filter(r => (Number(r.ratingAverage) || 0) >= minRating);
    }
    if (maxDeliveryMinutes !== undefined) {
      // `undefined <= 30` is false, so an unknown delivery time would quietly
      // empty the list for anyone who has not set a location. A kitchen whose
      // time we cannot compute is kept rather than judged.
      annotated = annotated.filter(
        r => r.estimatedDeliveryMinutes === undefined || r.estimatedDeliveryMinutes <= maxDeliveryMinutes
      );
    }
    // A kitchen that has not published a cost for two is kept in every price
    // band. Dropping it would hide a real restaurant because of a missing field.
    if (minCostForTwo !== undefined) {
      annotated = annotated.filter(r => r.costForTwo === undefined || Number(r.costForTwo) >= minCostForTwo);
    }
    if (maxCostForTwo !== undefined) {
      annotated = annotated.filter(r => r.costForTwo === undefined || Number(r.costForTwo) <= maxCostForTwo);
    }
    if (cuisine) {
      annotated = annotated.filter(r =>
        (r.cuisineTags || []).some((c: string) => c.toLowerCase() === cuisine)
      );
    }
    if (query) {
      annotated = annotated.filter(
        r =>
          r.name.toLowerCase().includes(query) ||
          (r.cuisineTags || []).some((c: string) => c.toLowerCase().includes(query))
      );
    }

    const byRating = (a: any, b: any) => (Number(b.ratingAverage) || 0) - (Number(a.ratingAverage) || 0);

    /**
     * Sorts unknown values last rather than first.
     *
     * Distance and delivery time are undefined for a customer who has not set a
     * location. Subtracting undefined gives NaN, and a comparator returning NaN
     * leaves the array in whatever order the engine happened to be in — so the
     * bug is not "wrong order" but "different order every time", which is the
     * kind of thing that never reproduces when someone goes looking for it.
     */
    const last = (n: number | undefined) => n ?? Number.MAX_SAFE_INTEGER;

    switch (sort) {
      case 'rating':
        annotated.sort(byRating);
        break;
      case 'deliveryTime':
        annotated.sort((a, b) => last(a.estimatedDeliveryMinutes) - last(b.estimatedDeliveryMinutes));
        break;
      case 'distance':
        // Unmeasured restaurants sort last rather than to the front, which is
        // where `undefined - undefined` (NaN) would have left them.
        annotated.sort((a, b) => last(a.distanceKm) - last(b.distanceKm));
        break;
      case 'costLowToHigh':
        annotated.sort((a, b) => (Number(a.costForTwo) || 0) - (Number(b.costForTwo) || 0));
        break;
      case 'costHighToLow':
        annotated.sort((a, b) => (Number(b.costForTwo) || 0) - (Number(a.costForTwo) || 0));
        break;
      default:
        // Relevance: an open kitchen first — a closed one cannot be ordered
        // from, so however good it is it is not the most relevant thing on the
        // screen — then nearest, then best rated.
        annotated.sort(
          (a, b) =>
            Number(isKitchenServing(b)) - Number(isKitchenServing(a)) ||
            last(a.distanceKm) - last(b.distanceKm) ||
            byRating(a, b)
        );
    }

    return res.json({
      success: true,
      data: {
        restaurants: annotated,
        /*
         * The home screen's hero banner, or null.
         *
         * It used to be three lines of text in the app - "HOT DEALS / UP TO 50%
         * OFF / Use WELCOME50" - shown to every customer on every launch,
         * regardless of whether WELCOME50 existed, had expired, or had ever
         * been created. It is now the best live platform-wide coupon, and null
         * when there is none, in which case the app shows no banner at all.
         *
         * Platform-wide specifically: the banner sits above the whole feed, and
         * a restaurant-specific coupon promised there would be refused at
         * almost every kitchen underneath it.
         */
        promotion: platformPromotion(coupons),
        // Echoed back so the app can show which filters produced this result,
        // and so a filter the server ignored is visibly absent rather than
        // appearing to have been applied.
        appliedFilters: {
          isPureVeg,
          openNow,
          minRating,
          maxDeliveryMinutes,
          minCostForTwo,
          maxCostForTwo,
          cuisine: cuisine || undefined,
          q: query || undefined,
          sort
        },
        total: annotated.length
      }
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/restaurants/owner/:ownerId
restaurantRouter.get('/owner/:ownerId', authMiddleware(), async (req: any, res) => {
  try {
    // Only the owner, or staff. It returns the kitchen's own prices and full
    // record, and used to answer anybody who knew an owner's user id.
    const isStaff = req.user?.role === 'admin' || req.user?.role === 'super_admin';
    if (!isStaff && req.user?.id !== req.params.ownerId) {
      return res.status(403).json({
        success: false,
        error: { code: 'NOT_RESTAURANT_OWNER', message: 'You do not manage this restaurant.' }
      });
    }
    const all = await restaurantRepository.listAll();
    const found = all.find((r: Restaurant) => r.ownerId === req.params.ownerId);
    if (!found) {
      return res.status(404).json({
        success: false,
        error: { code: 'NO_RESTAURANT_LINKED', message: 'No restaurant is linked to this account yet.' }
      });
    }
    const menu = await menuRepository.findByRestaurantId(found.id);
    return res.json({ success: true, data: { restaurant: found, menu } });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/restaurants/:id
restaurantRouter.get('/:id', async (req, res) => {
  try {
    const restaurant = await restaurantRepository.findById(req.params.id);
    if (!restaurant) {
      return res.status(404).json({ success: false, error: 'Restaurant not found' });
    }
    const menu = inflateMenuForCustomer(
      await menuRepository.findByRestaurantId(restaurant.id),
      restaurant.id
    );
    return res.json({ success: true, data: { restaurant, menu } });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/restaurants/:id/menu
restaurantRouter.get('/:id/menu', async (req, res) => {
  try {
    // Marked up for the customer. This is a VIEW: `inflateMenuForCustomer`
    // never writes, so the kitchen's stored menu cannot drift upward on
    // every read.
    const menu = inflateMenuForCustomer(
      await menuRepository.findByRestaurantId(req.params.id),
      req.params.id
    );
    if (!menu) {
      return res.status(404).json({ success: false, error: 'Menu not found' });
    }
    return res.json({ success: true, data: { menu } });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/restaurants/:id/orders - Incoming restaurant orders
restaurantRouter.get('/:id/orders', authMiddleware('restaurant_owner'), async (req, res, next) => {
  try {
    // Being a partner is not enough — this returns customer names, phone numbers and
    // delivery addresses, so the caller must own *this* restaurant.
    await assertOwnsRestaurant(req, req.params.id);

    const orders = await orderRepository.listByRestaurantId(req.params.id);
    // Shaped rather than having one field deleted. The doorstep OTP is only the
    // most obvious thing the kitchen must not have; the same shaping also stops
    // a delivered order leaving the customer's phone number on a kitchen tablet
    // indefinitely, which deleting one field did not.
    // P7: an order nobody accepts is cancelled automatically after
    // ORDER_ACCEPT_TIMEOUT_MINUTES. The kitchen is told the deadline, so the
    // app can count it down instead of the order vanishing without warning.
    const acceptMs = config.ORDER_ACCEPT_TIMEOUT_MINUTES * 60_000;
    const safeOrders = orders.map((order: any) => {
      const shaped: any = shapeOrderForViewer(order, 'restaurant');
      if (order.status === 'ORDER_PLACED' && order.createdAt) {
        shaped.acceptBy = new Date(new Date(order.createdAt).getTime() + acceptMs).toISOString();
      }
      return shaped;
    });
    return res.json({ success: true, data: { orders: safeOrders } });
  } catch (err) {
    next(err);
  }
});


/**
 * Confirms the signed-in partner actually owns this restaurant.
 *
 * authMiddleware('restaurant_owner') only proves the caller is *a* partner. Without
 * this check any partner could edit a competitor's menu — verified reproducible:
 * a newly registered owner marked another restaurant's flagship dish sold out and
 * customers immediately saw it.
 */
async function assertOwnsRestaurant(req: any, restaurantId: string) {
  const restaurant = await restaurantRepository.findById(restaurantId);
  if (!restaurant) {
    throw new AppError('Restaurant not found.', 404, 'RESTAURANT_NOT_FOUND');
  }
  const isStaff = req.user?.role === 'admin' || req.user?.role === 'super_admin';
  if (!isStaff && restaurant.ownerId !== req.user?.id) {
    throw new AppError('You do not manage this restaurant.', 403, 'NOT_RESTAURANT_OWNER');
  }
  return restaurant;
}

/**
 * GET /api/restaurants/:id/menu/manage — the menu as the KITCHEN set it.
 *
 * No markup. These are the prices the restaurant chose and the prices they are
 * paid on, and they are the only ones a partner should ever be shown. What a
 * customer pays may be higher; anything the platform adds is the platform's
 * and never reaches the restaurant.
 *
 * A separate endpoint rather than a flag on the customer one, because a query
 * parameter deciding whether a price is marked up is one somebody eventually
 * sends by accident — and a partner seeing our margin on their own dish is a
 * support ticket on every settlement. Here, who you are decides.
 */
restaurantRouter.get(
  '/:id/menu/manage',
  authMiddleware('restaurant_owner'),
  async (req, res, next) => {
    try {
      const restaurant = await assertOwnsRestaurant(req, req.params.id);
      const menu = await menuRepository.findByRestaurantId(restaurant.id);
      res.json({
        success: true,
        data: { menu: menu || { restaurantId: restaurant.id, categories: [] } }
      });
    } catch (err) {
      next(err);
    }
  }
);

const MenuItemSchema = z.object({
  name: z.string().min(1, 'name is required').max(120),
  description: z.string().max(400).optional().default(''),
  price: z.number().positive('price must be greater than zero').max(100000),
  isVeg: z.boolean(),
  isAvailable: z.boolean().optional().default(true),
  imageUrl: z.string().url('imageUrl must be a valid URL').optional(),
  categoryName: z.string().min(1, 'categoryName is required').max(80)
});

// POST /api/restaurants/:id/menu/items — add a dish
restaurantRouter.post(
  '/:id/menu/items',
  authMiddleware('restaurant_owner'),
  validate({ body: MenuItemSchema }),
  async (req, res, next) => {
    try {
      await assertOwnsRestaurant(req, req.params.id);
      const { categoryName, ...item } = req.body;
      const created = await menuRepository.addItem(req.params.id, categoryName, item as any);
      if (!created) throw new AppError('Menu not found for this restaurant.', 404, 'MENU_NOT_FOUND');

      emitMenuUpdated(req.params.id);
      res.status(201).json({ success: true, data: { item: created } });
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/restaurants/:id/menu/items/:dishId — edit or reprice a dish
restaurantRouter.put(
  '/:id/menu/items/:dishId',
  authMiddleware('restaurant_owner'),
  validate({ body: MenuItemSchema.partial() }),
  async (req, res, next) => {
    try {
      await assertOwnsRestaurant(req, req.params.id);
      const updated = await menuRepository.updateItem(req.params.id, req.params.dishId, req.body);
      if (!updated) throw new AppError('Dish not found on this menu.', 404, 'DISH_NOT_FOUND');

      emitMenuUpdated(req.params.id);
      res.json({ success: true, data: { item: updated } });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/restaurants/:id/menu/items/:dishId
restaurantRouter.delete(
  '/:id/menu/items/:dishId',
  authMiddleware('restaurant_owner'),
  async (req, res, next) => {
    try {
      await assertOwnsRestaurant(req, req.params.id);
      const removed = await menuRepository.removeItem(req.params.id, req.params.dishId);
      if (!removed) throw new AppError('Dish not found on this menu.', 404, 'DISH_NOT_FOUND');

      emitMenuUpdated(req.params.id);
      res.json({ success: true, data: { deleted: true } });
    } catch (err) {
      next(err);
    }
  }
);

const ToggleStockSchema = z.object({
  dishId: z.string().min(1, 'dishId is required'),
  isAvailable: z.boolean()
});

// POST /api/restaurants/:id/menu/toggle-stock
restaurantRouter.post('/:id/menu/toggle-stock', authMiddleware('restaurant_owner'), validate({ body: ToggleStockSchema }), async (req, res, next) => {
  try {
    await assertOwnsRestaurant(req, req.params.id);
    const { dishId, isAvailable } = req.body;
    const menu = await menuRepository.findByRestaurantId(req.params.id);
    if (!menu) {
      return res.status(404).json({ success: false, error: 'Menu not found' });
    }

    let found = false;
    for (const cat of menu.categories) {
      for (const item of cat.items) {
        if (item.id === dishId) {
          item.isAvailable = Boolean(isAvailable);
          found = true;
          break;
        }
      }
      if (found) break;
    }

    if (!found) {
      return res.status(404).json({ success: false, error: 'Dish not found in menu' });
    }

    await menuRepository.upsert(menu);

    // Adding or editing a dish already announced itself; running out did not, so
    // a customer could keep adding something the kitchen had just pulled.
    emitMenuUpdated(req.params.id);

    return res.json({ success: true, message: 'Stock status updated successfully', data: { dishId, isAvailable } });
  } catch (err) {
    next(err);
  }
});

const KitchenStatusSchema = z.object({
  isKitchenActive: z.boolean()
});

// POST /api/restaurants/:id/kitchen-status
restaurantRouter.post('/:id/kitchen-status', authMiddleware('restaurant_owner'), validate({ body: KitchenStatusSchema }), async (req, res, next) => {
  try {
    const owned = await assertOwnsRestaurant(req, req.params.id);
    const { isKitchenActive } = req.body;

    /*
     * Going online is gated on approval; going offline never is.
     *
     * The delivery app has had this check since it was written — a rider whose
     * KYC is not ACTIVE is refused at `POST /riders/shift`. The partner app had
     * nothing equivalent, so a restaurant that registered thirty seconds ago,
     * with no documents submitted and nobody having looked at it, could press
     * Online and be told "Kitchen is now ONLINE".
     *
     * It was not, in the way that mattered: the customer feed reads
     * `listActive()` and order creation refuses a non-ACTIVE restaurant, so no
     * customer ever saw it and no order could reach it. What the partner saw
     * was a green toggle and a promise, and they waited for orders that could
     * not arrive. A control that lies in the safe direction is still a control
     * that lies.
     *
     * Refused here rather than hidden in the app, because hiding a button is a
     * courtesy and this is the switch that decides whether a kitchen is open.
     */
    if (isKitchenActive && owned.status !== 'ACTIVE') {
      throw new AppError(
        owned.status === 'SUSPENDED'
          ? 'Your restaurant is suspended, so it cannot go online. Contact Quick Bites support.'
          : owned.status === 'CLOSED'
            ? 'This restaurant is closed on the platform and cannot go online.'
            : 'Your restaurant is still being verified. You can go online once our team approves your documents.',
        409,
        owned.status === 'PENDING_APPROVAL' ? 'RESTAURANT_NOT_APPROVED' : 'RESTAURANT_NOT_ACTIVE'
      );
    }

    // Goes through the repository so the change is persisted. Assigning isOpen on
    // the object skipped triggerAutoSave, so the kitchen reverted to its previous
    // state on the next restart and the partner saw "Online" after going offline.
    const restaurant = await restaurantRepository.setOpenState(req.params.id, Boolean(isKitchenActive));
    if (!restaurant) {
      return res.status(404).json({ success: false, error: 'Restaurant not found' });
    }

    /*
     * TAPPING ONLINE MUST PUT YOU ONLINE.
     *
     * Declared hours were closing a kitchen whose partner had just said they
     * were open. A partner who comes in early, taps Online and then watches
     * the app tell customers they are shut has been overruled by a schedule
     * they set for their own convenience.
     *
     * The owner was explicit: the schedule may take a kitchen OFF shift when
     * they forget, and must never refuse to put them ON. So going online
     * outside declared hours records an override that lapses at the next
     * scheduled closing time - the same mechanism the manual "stay open late"
     * button uses, rather than a second one invented beside it.
     *
     * Going OFFLINE clears it. Choosing to close is a decision about right
     * now, and leaving an override behind would reopen them unexpectedly.
     */
    if (!isKitchenActive) {
      await restaurantRepository.setForceOpenUntil(restaurant.id, undefined);
    } else if (isWithinOpeningHours(restaurant.openingHours, new Date()) === false) {
      const lapsesAt = nextClosesAt(restaurant.openingHours, new Date());
      if (lapsesAt) {
        await restaurantRepository.setForceOpenUntil(restaurant.id, lapsesAt.toISOString());
      }
    }

    emitKitchenStatus(restaurant.id, { isKitchenActive: restaurant.isOpen });

    return res.json({
      success: true,
      message: `Kitchen is now ${restaurant.isOpen ? 'ONLINE' : 'OFFLINE'}`,
      data: { isOpen: restaurant.isOpen, changedAt: restaurant.kitchenStatusChangedAt }
    });
  } catch (err) {
    next(err);
  }
});

// NOTE: a second POST /:id/menu/items used to be declared here. Express matches the
// first registration, so it never ran — but it omitted the assertOwnsRestaurant check,
// and would have silently reopened the cross-restaurant write hole if the routes were
// ever reordered. The guarded definition above is the only one.

// ---------------------------------------------------------------------------
// Menu change requests
//
// A partner asks for a dish to be added or changed; an administrator approves it
// before it reaches a customer. Nothing here writes to the live menu — approval,
// in adminRouter, is the only path that does.
// ---------------------------------------------------------------------------

const MenuRequestSchema = z.object({
  kind: z.enum(['ADD_ITEM', 'EDIT_ITEM']).optional().default('ADD_ITEM'),
  dishId: z.string().min(1).optional(),
  name: z.string().trim().min(1, 'Dish name is required').max(120),
  description: z.string().trim().max(400).optional(),
  price: z.number().positive('Price must be greater than zero').max(100000),
  isVeg: z.boolean(),
  categoryName: z.string().trim().min(1, 'Category is required').max(80),
  /**
   * A link, or a data URI from the partner app's own camera.
   *
   * Capped at the same 200,000 characters the admin catalogue routes use. They
   * disagreed before: a partner could submit a photo larger than an
   * administrator could ever edit, so the first attempt to correct that dish
   * would fail validation on a field nobody had touched.
   */
  imageUrl: z.string().trim().max(200000).optional(),
  /**
   * F05. Half/full plate and the like: each size with its REAL price. Two to
   * four, names distinct. An empty list on an edit removes the sizes.
   */
  sizes: z
    .array(z.object({
      name: z.string().trim().min(1, 'Name each size').max(40),
      price: z.number().positive('Each size needs a price above zero').max(100000)
    }))
    .max(4, 'At most 4 sizes')
    .refine(list => list.length === 0 || list.length >= 2, 'Give at least 2 sizes, or none')
    .refine(list => new Set(list.map(s => s.name.toLowerCase())).size === list.length, 'Two sizes have the same name')
    .optional(),
  /** F05. Optional extras a customer can add, each with its own price. */
  extras: z
    .array(z.object({
      name: z.string().trim().min(1, 'Name each extra').max(40),
      price: z.number().positive('Each extra needs a price above zero').max(100000)
    }))
    .max(10, 'At most 10 extras')
    .refine(list => new Set(list.map(s => s.name.toLowerCase())).size === list.length, 'Two extras have the same name')
    .optional()
});

// POST /api/restaurants/:id/menu/requests — partner submits a menu change for review
restaurantRouter.post(
  '/:id/menu/requests',
  authMiddleware('restaurant_owner'),
  validate({ body: MenuRequestSchema }),
  async (req, res, next) => {
    try {
      const restaurant = await assertOwnsRestaurant(req, req.params.id);
      const { kind, dishId, ...payload } = req.body;

      if (kind === 'EDIT_ITEM' && !dishId) {
        throw new AppError('An edit request must name the dish it changes.', 400, 'DISH_ID_REQUIRED');
      }

      const request = await menuRequestRepository.create({
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        requestedByUserId: req.user!.id,
        kind,
        dishId,
        payload
      });

      emitMenuRequestSubmitted(request);

      /*
       * `emitMenuRequestSubmitted` reaches an open console. This reaches a phone
       * in a pocket, which is the difference between a dish going live today and
       * a partner waiting until somebody happens to open the Catalogue screen.
       */
      void notifyAdminsMenuRequestRaised({
        requestId: request.id,
        restaurantName: restaurant.name,
        what:
          kind === 'EDIT_ITEM'
            ? `a change to ${payload.name || 'a dish'}`
            : kind === 'ADD_ITEM'
            ? `a new dish, ${payload.name || 'unnamed'}`
            : 'a menu change'
      });

      res.status(201).json({
        success: true,
        data: { request },
        message: 'Sent for review. You will see the dish on your menu once it is approved.'
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/restaurants/:id/menu/requests — the partner's own request history
restaurantRouter.get('/:id/menu/requests', authMiddleware('restaurant_owner'), async (req, res, next) => {
  try {
    await assertOwnsRestaurant(req, req.params.id);
    const requests = await menuRequestRepository.listByRestaurant(req.params.id);
    res.json({ success: true, data: { requests } });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Partner dashboard and order history
// ---------------------------------------------------------------------------

/**
 * GET /api/restaurants/:id/dashboard — the numbers behind the partner's home screen.
 *
 * Computed from the restaurant's own orders on every request rather than kept as a
 * running total, so a refund or a cancellation is reflected immediately and there
 * is no second copy of the figures to drift.
 */
restaurantRouter.get('/:id/dashboard', authMiddleware('restaurant_owner'), async (req, res, next) => {
  try {
    const restaurant = await assertOwnsRestaurant(req, req.params.id);
    const [orders, menu] = await Promise.all([
      orderRepository.listByRestaurantId(req.params.id),
      menuRepository.findByRestaurantId(req.params.id)
    ]);

    // The kitchen's own prices: the dashboard's sales and dish revenue used to
    // sum the customer's marked-up bill, which is the platform's markup shown
    // to the partner as their own takings.
    const dashboard = buildRestaurantDashboard(
      orders.map(o => shapeOrderForViewer(o, 'restaurant') as unknown as typeof o),
      menu
    );
    res.json({
      success: true,
      data: {
        dashboard,
        restaurant: {
          id: restaurant.id,
          name: restaurant.name,
          isOpen: restaurant.isOpen,
          status: restaurant.status,
          kycStatus: restaurant.kycStatus,
          ratingAverage: restaurant.ratingAverage,
          ratingCount: restaurant.ratingCount
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/restaurants/:id/orders/history — past orders, newest first.
 *
 * Separate from /orders, which is the live queue: the kitchen screen wants what is
 * cooking now, and this wants what already happened. `scope` selects completed,
 * cancelled or everything; the OTP is stripped here as it is on the live queue.
 */
restaurantRouter.get('/:id/orders/history', authMiddleware('restaurant_owner'), async (req, res, next) => {
  try {
    await assertOwnsRestaurant(req, req.params.id);

    const scope = String(req.query.scope || 'all').toLowerCase();
    const limit = Math.min(Number(req.query.limit) || 100, 200);

    const all = await orderRepository.listByRestaurantId(req.params.id);
    const terminal = all.filter(o =>
      ['DELIVERED', 'CANCELLED', 'REFUNDED'].includes(o.status)
    );

    const filtered =
      scope === 'completed'
        ? terminal.filter(o => o.status === 'DELIVERED')
        : scope === 'cancelled'
          ? terminal.filter(o => o.status === 'CANCELLED' || o.status === 'REFUNDED')
          : terminal;

    const orders = filtered.slice(0, limit).map((order: any) => shapeOrderForViewer(order, 'restaurant'));

    res.json({
      success: true,
      data: {
        orders,
        counts: {
          all: terminal.length,
          completed: terminal.filter(o => o.status === 'DELIVERED').length,
          cancelled: terminal.filter(o => o.status === 'CANCELLED' || o.status === 'REFUNDED').length
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Document verification
// ---------------------------------------------------------------------------

/**
 * GET /api/restaurants/:id/documents — what is required, and where each one stands.
 *
 * Returns the catalogue merged with the restaurant's submissions, so the partner
 * app can render one list showing what is needed, why, the accepted formats and
 * the current status, instead of an opaque panel that never explained itself.
 */
restaurantRouter.get('/:id/documents', authMiddleware('restaurant_owner'), async (req, res, next) => {
  try {
    const restaurant = await assertOwnsRestaurant(req, req.params.id);
    const documents = await kycRepository.findByEntity('RESTAURANT', restaurant.id);
    const overview = buildDocumentOverview(documents);

    res.json({
      success: true,
      data: {
        ...overview,
        kycStatus: restaurant.kycStatus,
        acceptedFormats: ACCEPTED_FORMATS,
        maxSizeMb: MAX_UPLOAD_MB
      }
    });
  } catch (err) {
    next(err);
  }
});

const UploadDocumentSchema = z.object({
  documentType: z.enum(RESTAURANT_DOCUMENT_TYPES),
  documentNumber: z.string().trim().min(1, 'Enter the number printed on the document').max(40),
  /*
   * A photograph, not a sentence.
   *
   * This field used to accept any non-empty string, and the partner app sent
   * one: it had no picker at all, so it asked the partner to email the document
   * to support and type a note here describing where to find it. What reached
   * the reviewer was "emailed on 14 Sep" — a KYC queue full of prose that had
   * to be cross-referenced against an inbox by hand.
   *
   * Bounded and typed exactly as the rider route's equivalent. The ceiling is
   * the one the image helper in the app resizes to stay under, so an oversized
   * photo fails on the device with something the partner can act on rather than
   * being cut off by the 1 MB body limit.
   */
  fileUrl: z
    .string()
    .max(700_000, 'That photo is too large. Take a new one from inside the app.')
    .refine(
      v => v.startsWith('data:image/') || /^https?:\/\//.test(v),
      'Attach a photo of the document.'
    )
});

/**
 * POST /api/restaurants/:id/documents — upload, or re-upload after a rejection.
 *
 * A new submission for a type supersedes the previous one rather than editing it,
 * so the review history is preserved: an administrator can see that a document was
 * rejected once and what was sent the second time.
 */
restaurantRouter.post(
  '/:id/documents',
  authMiddleware('restaurant_owner'),
  validate({ body: UploadDocumentSchema }),
  async (req, res, next) => {
    try {
      const restaurant = await assertOwnsRestaurant(req, req.params.id);
      const { documentType, documentNumber, fileUrl } = req.body;

      const existing = await kycRepository.findByEntity('RESTAURANT', restaurant.id);
      const current = existing
        .filter(d => d.documentType === documentType)
        .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())[0];

      // Re-uploading over something already approved would quietly un-verify a
      // trading restaurant, so it is refused rather than silently accepted.
      if (current?.status === 'APPROVED') {
        throw new AppError(
          `Your ${documentType} is already verified. Contact support if it needs to change.`,
          409,
          'DOCUMENT_ALREADY_APPROVED'
        );
      }
      if (current?.status === 'PENDING') {
        throw new AppError(
          `Your ${documentType} is already with our team for review.`,
          409,
          'DOCUMENT_UNDER_REVIEW'
        );
      }

      const doc = await kycRepository.submitDocument({
        entityType: 'RESTAURANT',
        entityId: restaurant.id,
        entityName: restaurant.name,
        entityCity: restaurant.city,
        entityAddress: restaurant.addressLine,
        entityPhone: restaurant.phone,
        documentType,
        documentNumber,
        fileUrl
      });

      if (restaurant.kycStatus !== 'ACTIVE') {
        await restaurantRepository.updateKycStatus(restaurant.id, 'PENDING_APPROVAL');
      }

      /*
       * AND TELL SOMEBODY IT IS WAITING.
       *
       * The notification for this existed and was wired to `POST /kyc/submit`,
       * which NO app calls. The partner app uploads here. So a restaurant that
       * submitted its FSSAI licence and waited was waiting on a queue nobody had
       * been told about — and the alert looked built, because it was, against a
       * route with no callers.
       *
       * Not awaited: an upload must not fail because a push service is slow, and
       * the notifier catches its own errors.
       */
      void notifyAdminsKycSubmitted({
        documentId: doc.id,
        ownerName: restaurant.name,
        documentLabel: String(documentType).toLowerCase().replace(/_/g, ' ')
      });

      res.status(201).json({
        success: true,
        data: { document: doc },
        message: 'Uploaded. Our team reviews documents within one working day.'
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/restaurants/:id/settlements — what the platform owes this kitchen.
 *
 * The partner app could show takings but never what had been paid across, so a
 * restaurant had no way to reconcile the money it was owed against the money it
 * had received. Reads the same settlement records the admin console writes.
 */
restaurantRouter.get('/:id/settlements', authMiddleware('restaurant_owner'), async (req, res, next) => {
  try {
    const restaurant = await assertOwnsRestaurant(req, req.params.id);
    const delivered = (await orderRepository.listByRestaurantId(restaurant.id)).filter(
      o => o.status === 'DELIVERED'
    );

    /*
     * THE SAME FIGURES AS THE STATEMENT, AND AS THE OWNER'S PAY SCREEN.
     *
     * This used to compute its own answer: a hard-coded 15% commission on the
     * CUSTOMER's food total (so the platform's markup counted as the kitchen's
     * sales), TDS as 1% of the commission, no packaging, and "unsettled" meaning
     * "no old settlement id" — which no order has since Pay replaced Settlements.
     * A partner saw Rs 424.25 here and Rs 445 on the Statement tab beside it, for
     * the same money, and only the Statement was right.
     *
     * Now it reads the ledger through `statementFor`, over the whole history,
     * and keeps the response shape the installed partner app already reads.
     */
    const statement = statementFor('RESTAURANT', restaurant.id, restaurant.name, {
      from: new Date(0).toISOString()
    });
    const amountOf = (lines: Array<{ label: string; amountPaise: number }>, label: string) =>
      lines.filter(l => l.label === label).reduce((t, l) => t + l.amountPaise, 0);

    const lines = statement.orders
      .filter(o => !o.settledByPayoutId)
      .map(o => {
        const order = memoryStore.orders.get(o.orderId) as any;
        const salesPaise = amountOf(o.lines, 'Food total') + amountOf(o.lines, 'Packaging');
        return {
          orderId: o.orderId,
          orderNumber: o.orderNumber,
          deliveredAt: order?.deliveredAt || o.occurredAt,
          grossSales: toRupees(salesPaise),
          // Includes the kitchen's share of GST on it, so sales − commission − TDS
          // is the net on the installed app, which has no line for that share.
          commission: toRupees(-amountOf(o.lines, 'Our commission') - amountOf(o.lines, 'GST on our commission')),
          tds: toRupees(-amountOf(o.lines, 'TDS withheld')),
          net: toRupees(o.netPaise),
          released: o.released
        };
      });
    const sum = (key: 'grossSales' | 'commission' | 'tds') =>
      Math.round(lines.reduce((t, l) => t + l[key], 0) * 100) / 100;

    const PAYOUT_STATUS: Record<string, string> = {
      PAID: 'PAID',
      FAILED: 'FAILED',
      CANCELLED: 'FAILED',
      DRAFT: 'PENDING',
      AWAITING_APPROVAL: 'PENDING',
      APPROVED: 'PENDING'
    };
    /*
     * Two kinds of record, one list. A settlement drafted on the admin
     * Settlements screen is shown as that settlement (with its period, sales
     * and reference); a payout sent from Pay is shown as the payout. A payout
     * made TO pay a settlement carries its id and is not listed a second time.
     */
    const settlements = await settlementRepository.list({ restaurantId: restaurant.id });
    const settlementIds = new Set(settlements.map((st: any) => st.id));
    const payouts = listPayouts({ ownerId: restaurant.id }).filter(
      p => p.ownerType === 'RESTAURANT' && !(p.settlementId && settlementIds.has(p.settlementId))
    );
    const payoutRows = payouts.map(p => ({
      id: p.id,
      netAmount: toRupees(p.amountPaise),
      status: PAYOUT_STATUS[p.state] || 'PROCESSING',
      periodStart: p.draftedAt,
      periodEnd: p.executedAt || p.draftedAt,
      ordersCount: p.coversLedgerIds.length,
      ...(p.reference ? { reference: p.reference } : {}),
      ...(p.executedAt && p.state === 'PAID' ? { paidAt: p.executedAt } : {}),
      ...(p.note ? { note: p.note } : {})
    }));
    const history = [...settlements, ...payoutRows].sort((a: any, b: any) =>
      String(b.paidAt || b.periodEnd || '').localeCompare(String(a.paidAt || a.periodEnd || ''))
    );

    res.json({
      success: true,
      data: {
        summary: {
          ordersAllTime: delivered.length,
          ordersAwaitingSettlement: lines.length,
          grossPending: sum('grossSales'),
          commissionPending: sum('commission'),
          tdsPending: sum('tds'),
          // Payable now plus still inside the hold period: everything owed.
          netPending: toRupees(statement.summary.outstandingPaise),
          payableNow: toRupees(statement.summary.payablePaise),
          onHold: toRupees(statement.summary.heldPaise),
          paidToDate: toRupees(statement.summary.paidPaise),
          lastSettledAt: history.find(h => h.status === 'PAID')?.paidAt || null
        },
        pendingOrders: lines,
        history
      }
    });
  } catch (err) {
    next(err);
  }
});

/* =====================================================================
 * The restaurant's own profile - what a customer sees, and what the
 * partner has asked to change about it.
 *
 * Two versions of one restaurant, never one. Approval is the only thing
 * that writes to the live record, so there is no window in which an
 * unreviewed name or an unreviewed photograph is on the home screen.
 * ===================================================================== */

/**
 * Everything the partner app needs to draw the edit form, from the server.
 *
 * The limits, the day names and the editable field list are sent rather than
 * hardcoded in the app, so a rule can never be changed on the server and left
 * stale in four APKs that are already on people's phones. The app that shipped
 * last month gets today's rules the moment it opens this screen.
 */
restaurantRouter.get('/:id/profile', authMiddleware('restaurant_owner'), async (req, res, next) => {
  try {
    const restaurant = await assertOwnsRestaurant(req, req.params.id);
    const pending = await profileEditRepository.findPendingByRestaurant(restaurant.id);
    const openNow = isWithinOpeningHours(restaurant.openingHours, new Date());

    res.json({
      success: true,
      data: {
        // What customers see right now.
        published: readEditableProfile(restaurant),
        // What is waiting on a reviewer, or null. The app marks exactly these
        // fields "in review", so a partner never re-submits a change they have
        // already made and wonders why nothing happened.
        pending: pending
          ? {
              id: pending.id,
              submittedAt: pending.submittedAt,
              changes: pending.changes,
              previous: pending.previous,
              fields: Object.keys(pending.changes)
            }
          : null,
        kitchen: {
          status: restaurant.status,
          isOpen: restaurant.isOpen,
          /** null = hours were never declared, which is not the same as closed. */
          withinDeclaredHours: openNow,
          forceOpenUntil: restaurant.forceOpenUntil ?? null,
          /** A partner may only go online once the platform has approved them. */
          canGoOnline: restaurant.status === 'ACTIVE'
        },
        rules: {
          editableFields: EDITABLE_PROFILE_FIELDS,
          maxNameChars: MAX_NAME_CHARS,
          maxDescriptionChars: MAX_DESCRIPTION_CHARS,
          maxCuisineTags: MAX_CUISINE_TAGS,
          maxGalleryImages: MAX_GALLERY_IMAGES,
          maxImageChars: MAX_IMAGE_CHARS,
          daysOfWeek: DAYS_OF_WEEK,
          maxWindowsPerDay: MAX_WINDOWS_PER_DAY,
          /** Said plainly, because the partner app shows this sentence. */
          reviewNotice:
            'Changes to your profile are checked by our team before customers see them. Your restaurant keeps trading in the meantime.'
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Submits changes for review.
 *
 * Deliberately NOT a PATCH of the restaurant. Nothing here touches the live
 * record: it records an intention, and a reviewer decides. The response says
 * whether anything was actually submitted, because a partner who taps Save and
 * is told "sent for review" with an empty queue behind it has been told a lie
 * about work they believe is under way.
 */
/*
 * Declared for the body contract check (S13). Passthrough, not strip: the
 * handler REFUSES a field a partner may not change (commissionPercent, say)
 * by name, and stripping it first would turn that refusal into silence.
 */
const ProfileBodySchema = z
  .object(Object.fromEntries(EDITABLE_PROFILE_FIELDS.map(f => [f, z.unknown()])) as Record<string, z.ZodUnknown>)
  .passthrough();

restaurantRouter.put('/:id/profile', authMiddleware('restaurant_owner'), validate({ body: ProfileBodySchema }), async (req, res, next) => {
  try {
    const restaurant = await assertOwnsRestaurant(req, req.params.id);

    const validated = validateProfileChanges(req.body);
    if (!validated.ok) {
      throw new AppError(validated.errors.join(' '), 400, 'INVALID_PROFILE_CHANGES');
    }

    const current = readEditableProfile(restaurant);
    const { changes, previous, changedFields } = diffProfile(current, validated.value!);

    if (changedFields.length === 0) {
      // Not an error. The partner app posts the whole form on save, so a Save
      // with nothing touched is normal and must not look like a failure - nor
      // like a submission.
      res.json({
        success: true,
        data: {
          submitted: false,
          edit: null,
          message: 'Nothing has changed, so there is nothing to review.'
        }
      });
      return;
    }

    const edit = await profileEditRepository.create({
      restaurantId: restaurant.id,
      submittedByUserId: req.user!.id,
      changes,
      previous
    });

    void notifyAdminsProfileEditRaised({ editId: edit.id, restaurantName: restaurant.name });

    res.status(201).json({
      success: true,
      data: {
        submitted: true,
        edit: {
          id: edit.id,
          submittedAt: edit.submittedAt,
          status: edit.status,
          fields: changedFields,
          changes: edit.changes,
          previous: edit.previous
        },
        message:
          'Sent for review. Customers keep seeing your current details until our team approves the change.'
      }
    });
  } catch (err) {
    next(err);
  }
});

/** Everything this partner has ever submitted, newest first, with the outcome. */
restaurantRouter.get('/:id/profile/edits', authMiddleware('restaurant_owner'), async (req, res, next) => {
  try {
    const restaurant = await assertOwnsRestaurant(req, req.params.id);
    const history = await profileEditRepository.listByRestaurant(restaurant.id);

    res.json({
      success: true,
      data: {
        edits: history.map(edit => ({
          id: edit.id,
          submittedAt: edit.submittedAt,
          status: edit.status,
          fields: Object.keys(edit.changes),
          changes: edit.changes,
          previous: edit.previous,
          approvedFields: edit.approvedFields ?? [],
          // The reason lives on the field, not the submission, so a partner is
          // told what to fix rather than that "something" was refused.
          rejections: edit.rejections ?? [],
          reviewedAt: edit.reviewedAt ?? null
        }))
      }
    });
  } catch (err) {
    next(err);
  }
});

const HoursOverrideSchema = z.object({
  /** Minutes from now. Zero cancels an override already in force. */
  minutes: z.number().int().min(0).max(12 * 60)
});

/**
 * "I know we are outside our hours. We are serving anyway."
 *
 * Declared hours close a kitchen the partner forgot to close. This is the other
 * direction, and it expires by itself - capped at twelve hours - so an override
 * can never quietly become permanent, which is the exact failure declared hours
 * were introduced to fix.
 *
 * Gated on approval for the same reason going online is: this is a switch that
 * decides whether a kitchen takes orders.
 */
restaurantRouter.post(
  '/:id/hours-override',
  authMiddleware('restaurant_owner'),
  validate({ body: HoursOverrideSchema }),
  async (req, res, next) => {
    try {
      const restaurant = await assertOwnsRestaurant(req, req.params.id);
      const minutes = Number(req.body.minutes);

      if (minutes > 0 && restaurant.status !== 'ACTIVE') {
        throw new AppError(
          'Your restaurant is still being verified, so it cannot take orders yet.',
          409,
          restaurant.status === 'PENDING_APPROVAL' ? 'RESTAURANT_NOT_APPROVED' : 'RESTAURANT_NOT_ACTIVE'
        );
      }

      const until = minutes > 0 ? new Date(Date.now() + minutes * 60_000).toISOString() : undefined;
      const updated = await restaurantRepository.setForceOpenUntil(restaurant.id, until);
      const endsAt = updated?.forceOpenUntil ? new Date(updated.forceOpenUntil) : null;

      res.json({
        success: true,
        data: {
          forceOpenUntil: updated?.forceOpenUntil ?? null,
          message: endsAt
            ? 'Staying open until ' +
              formatTimeOfDay(endsAt.getHours() * 60 + endsAt.getMinutes()) +
              '. After that your normal hours apply again.'
            : 'Your normal opening hours apply again.'
        }
      });
    } catch (err) {
      next(err);
    }
  }
);
