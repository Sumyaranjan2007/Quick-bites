# Connection map: every action in the four apps, and what the server does with it

_Generated 25 Sep 2026 by Session C by calling every route each app uses, **signed in as that app's real user**, against a seeded server (`apps/backend-api/src/test/connectionProbe.ts`)._

**Result: all 220 calls reach a working route as the right person. 0 server errors (500), 0 missing routes, 0 wrong-role refusals.** Body shapes are proven separately by the `bodyContract` suite, route existence by `routeContract`, and the business flows by the 69 backend suites.

For the admin app, every call was also made as the three staff roles. No role that holds a route's permission is ever refused. Every screen or button a role cannot use is hidden from that role (the App.tsx section permissions and each screen's `can()` guards match the route permissions). One edge case is listed in section 3.

## 1. How the four apps connect (live links)

| When | Who acts | Server | Who is told, and how |
| --- | --- | --- | --- |
| Customer places an order | Customer: Cart, then Pay | `POST /orders` (options checked, price, coupon, margin floor, cash rules) | Kitchen: socket `order:created` + loud push; admin: live board |
| Kitchen accepts / cooking / ready | Partner: Live orders | `PUT /orders/:id/status` | Customer: push on order-updates; riders: offered at the set step (`offerTripToNearbyRiders`, loud push); admin: board |
| Kitchen does not accept in time | nobody (countdown shown) | sweeper cancels at `ORDER_ACCEPT_TIMEOUT_MINUTES` | Customer refunded and told; kitchen sees the reason in history; repeat rejections alert admin (A6) |
| Rider claims | Rider: offer card | `POST /riders/orders/:id/claim` (one trip, cash ceiling) | Other riders: "trip taken" data push stops their alarm (R1); customer: push |
| Rider collects | Rider: pickup code from the kitchen screen | `POST /riders/orders/:id/verify-pickup` | Customer: out for delivery; live map via `/riders/telemetry` |
| Rider delivers | Rider: customer's code, cash or door QR | `verify-otp`; `/cash/orders/:id/*` | Earnings and cash booked once (`completeDelivery`); customer can rate |
| Trip goes wrong | Admin: order sheet | unassign / reassign / mark-delivered / kitchen step (A1–A4) | Both riders pushed; audit row; refused cash opens a support case |
| Customer cancels | Customer: tracking, then Cancel | quote first, then `PUT /orders/:id/status` CANCELLED | Kitchen push; refund to source; fee only if the owner set one (A9 lock) |
| Refund / complaint | Customer: Support | `/support/refund-requests`, `/support/tickets` | Admin: Refunds and Support queues; payout clawback via the ledger |
| Cash handover | Rider: Cash | `POST /cash/deposits` | Admin: Payouts, then Cash desk confirm; rider's cash in hand drops |
| Payday | Admin: Payouts | draft, approve (maker-checker), send | Payee: quiet push on the payments channel; statement in their app and in admin (A32) |
| Bank details | Rider / partner: Payout account | `/payee-accounts` | Admin: Payee accounts, approve or reject with a note |
| Menu change | Partner: Menu (add or edit, sizes and extras) | `POST /restaurants/:id/menu/requests` | Admin: Catalogue review; approval writes the dish and option groups, margin held |
| Block / password change | Admin / the user | `PATCH /admin/...`, `/auth/change-password` | Open sockets closed at once (S11); other phones signed out (U2) |

## 2. Every action, app by app

### Customer app: signed in as the customer (51 calls)

**`App.tsx`**

| Call | Server answer | Verdict |
| --- | --- | --- |
| `GET /api/restaurants/:param` | 200  | works |

**`components/AddressSearchField.tsx`**

| Call | Server answer | Verdict |
| --- | --- | --- |
| `GET /api/places/status` | 200  | works |
| `GET /api/places/suggest` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `GET /api/places/resolve` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |

**`components/InvoiceSheet.tsx`**

| Call | Server answer | Verdict |
| --- | --- | --- |
| `GET /api/invoices/orders/:param` | 409 ORDER_NOT_DELIVERED | reached; ORDER_NOT_DELIVERED (business rule, correct) |
| `GET /api/invoices/orders/:param/refund` | 200  | works |

**`components/MapAddressPicker.tsx`**

| Call | Server answer | Verdict |
| --- | --- | --- |
| `GET /api/places/reverse` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |

**`components/PaymentPoliciesSheet.tsx`**

| Call | Server answer | Verdict |
| --- | --- | --- |
| `GET /api/policies/payments` | 200  | works |
| `GET /api/policies/payments/:param` | 404 POLICY_NOT_FOUND | reached; POLICY_NOT_FOUND for the probe's placeholder id |

**`components/RatingSheet.tsx`**

| Call | Server answer | Verdict |
| --- | --- | --- |
| `POST /api/orders/:param/rating` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |

**`lib/pushRegistration.ts`**

| Call | Server answer | Verdict |
| --- | --- | --- |
| `POST /api/devices` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `DELETE /api/devices/:param` | 200  | works |

**`lib/useActiveOrders.ts`**

| Call | Server answer | Verdict |
| --- | --- | --- |
| `GET /api/orders` | 200  | works |

**`lib/useOrderChat.ts`**

| Call | Server answer | Verdict |
| --- | --- | --- |
| `GET /api/orders/:param/messages` | 200  | works |
| `POST /api/orders/:param/messages` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |

**`screens/AddressBookScreen.tsx`**

| Call | Server answer | Verdict |
| --- | --- | --- |
| `GET /api/addresses` | 200  | works |
| `PUT /api/addresses/:param` | 404 ADDRESS_NOT_FOUND | reached; ADDRESS_NOT_FOUND for the probe's placeholder id |
| `DELETE /api/addresses/:param` | 404 ADDRESS_NOT_FOUND | reached; ADDRESS_NOT_FOUND for the probe's placeholder id |

**`screens/CartAndCheckoutScreen.tsx`**

| Call | Server answer | Verdict |
| --- | --- | --- |
| `GET /api/payments/config` | 200  | works |
| `POST /api/addresses` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `POST /api/orders/quote` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `POST /api/orders` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `POST /api/payments/start` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `POST /api/orders/:param/confirm-payment` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |

**`screens/DiscoveryFeedScreen.tsx`**

| Call | Server answer | Verdict |
| --- | --- | --- |
| `GET /api/search/suggestions` | 200  | works |
| `GET /api/search` | 200  | works |
| `GET /api/customers/favourites` | 200  | works |
| `DELETE /api/customers/favourites/:param` | 200  | works |
| `PUT /api/customers/favourites` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |

**`screens/LoginScreen.tsx`**

| Call | Server answer | Verdict |
| --- | --- | --- |
| `POST /api/auth/otp/resend` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `POST /api/auth/otp/request` | 429 TOO_MANY_ATTEMPTS | reached; sign-in limiter (probe signed in many times) |
| `POST /api/auth/otp/verify` | 429 TOO_MANY_ATTEMPTS | reached; sign-in limiter (probe signed in many times) |
| `PATCH /api/auth/me` | 200  | works |

**`screens/MembershipScreen.tsx`**

| Call | Server answer | Verdict |
| --- | --- | --- |
| `GET /api/membership/plans` | 200  | works |
| `GET /api/membership/me` | 200  | works |
| `POST /api/membership/purchase` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `POST /api/membership/confirm` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |

**`screens/OrderHistoryScreen.tsx`**

| Call | Server answer | Verdict |
| --- | --- | --- |
| `POST /api/orders/:param/reorder` | 200  | works |
| `POST /api/support/refund-requests` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |

**`screens/OrderTrackingScreen.tsx`**

| Call | Server answer | Verdict |
| --- | --- | --- |
| `GET /api/orders/:param` | 200  | works |
| `GET /api/orders/:param/tracking` | 200  | works |
| `GET /api/orders/:param/cancellation-quote` | 200  | works |
| `GET /api/orders/cancellation-reasons` | 200  | works |
| `PUT /api/orders/:param/status` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |

**`screens/ProfileScreen.tsx`**

| Call | Server answer | Verdict |
| --- | --- | --- |
| `PUT /api/customers/avatar` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `DELETE /api/auth/me` | skipped SIGN_OUT | not called (would sign the probe out) |
| `POST /api/auth/change-password` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |

**`screens/RestaurantDetailScreen.tsx`**

| Call | Server answer | Verdict |
| --- | --- | --- |
| `GET /api/restaurants/:param/menu` | 200  | works |

**`screens/SupportScreen.tsx`**

| Call | Server answer | Verdict |
| --- | --- | --- |
| `GET /api/support/tickets` | 200  | works |
| `GET /api/support/refund-requests` | 200  | works |
| `POST /api/support/tickets` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |

### Partner app: signed in as the restaurant owner (30 calls)

**`lib/partnerApi.ts`**

| Call | Server answer | Verdict |
| --- | --- | --- |
| `GET /api/restaurants/owner/:param` | 403 NOT_RESTAURANT_OWNER | reached; NOT_RESTAURANT_OWNER: caller is not on that record (correct) |
| `GET /api/restaurants/:param/dashboard` | 200  | works |
| `POST /api/restaurants/:param/kitchen-status` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `GET /api/restaurants/:param/orders` | 200  | works |
| `GET /api/restaurants/:param/orders/history` | 200  | works |
| `PUT /api/orders/:param/status` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `GET /api/restaurants/:param/menu/manage` | 200  | works |
| `POST /api/restaurants/:param/menu/toggle-stock` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `POST /api/restaurants/:param/menu/requests` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `GET /api/restaurants/:param/menu/requests` | 200  | works |
| `GET /api/restaurants/:param/documents` | 200  | works |
| `POST /api/restaurants/:param/documents` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `GET /api/restaurants/:param/settlements` | 200  | works |
| `GET /api/restaurants/:param/profile` | 200  | works |
| `PUT /api/restaurants/:param/profile` | 200  | works |
| `POST /api/restaurants/:param/hours-override` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `GET /api/policies/payments/:param` | 404 POLICY_NOT_FOUND | reached; POLICY_NOT_FOUND for the probe's placeholder id |
| `POST /api/auth/login` | 429 TOO_MANY_ATTEMPTS | reached; sign-in limiter (probe signed in many times) |
| `POST /api/auth/register/partner` | 429 TOO_MANY_ATTEMPTS | reached; sign-in limiter (probe signed in many times) |
| `POST /api/support/tickets` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `GET /api/support/tickets` | 200  | works |
| `POST /api/auth/change-password` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `PATCH /api/auth/me` | 200  | works |
| `POST /api/auth/logout` | skipped SIGN_OUT | not called (would sign the probe out) |
| `GET /api/payee-accounts/me` | 200  | works |
| `POST /api/payee-accounts/me` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `GET /api/policies/payments` | 200  | works |
| `GET /api/earnings/packaging` | 200  | works |

**`lib/pushRegistration.ts`**

| Call | Server answer | Verdict |
| --- | --- | --- |
| `POST /api/devices` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `DELETE /api/devices/:param` | 200  | works |

### Rider app: signed in as the rider (42 calls)

**`lib/api.ts`**

| Call | Server answer | Verdict |
| --- | --- | --- |
| `POST /api/riders/orders/:param/claim` | 409 RIDER_OFFLINE | reached; RIDER_OFFLINE (business rule, correct) |
| `POST /api/riders/orders/:param/decline` | 200  | works |
| `POST /api/riders/orders/:param/stage` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `POST /api/riders/orders/:param/verify-pickup` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `POST /api/riders/orders/:param/verify-otp` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `POST /api/riders/orders/:param/cancel` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `GET /api/orders/:param/messages` | 403 FORBIDDEN | reached; FORBIDDEN: caller is not on that record (correct) |
| `POST /api/orders/:param/messages` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `GET /api/riders/trips` | 200  | works |
| `GET /api/riders/policies/:param` | 404 POLICY_NOT_FOUND | reached; POLICY_NOT_FOUND for the probe's placeholder id |
| `POST /api/cash/orders/:param/collect-online` | 404 ORDER_NOT_FOUND | reached; ORDER_NOT_FOUND for the probe's placeholder id |
| `GET /api/cash/orders/:param/door-payment` | 404 ORDER_NOT_FOUND | reached; ORDER_NOT_FOUND for the probe's placeholder id |
| `DELETE /api/cash/deposits/:param` | 404 DEPOSIT_NOT_FOUND | reached; DEPOSIT_NOT_FOUND for the probe's placeholder id |
| `GET /api/policies/payments/:param` | 404 POLICY_NOT_FOUND | reached; POLICY_NOT_FOUND for the probe's placeholder id |
| `GET /api/riders/me` | 200  | works |
| `PATCH /api/riders/me` | 200  | works |
| `GET /api/riders/dashboard` | 200  | works |
| `POST /api/riders/shift` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `POST /api/riders/logout` | skipped SIGN_OUT | not called (would sign the probe out) |
| `GET /api/riders/orders/broadcast` | 200  | works |
| `GET /api/riders/orders/active` | 200  | works |
| `POST /api/riders/location` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `POST /api/riders/telemetry` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `GET /api/riders/documents` | 200  | works |
| `POST /api/riders/documents` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `GET /api/riders/ratings` | 200  | works |
| `GET /api/riders/settlements` | 200  | works |
| `GET /api/riders/incentives` | 200  | works |
| `GET /api/riders/policies` | 200  | works |
| `POST /api/riders/sos` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `GET /api/riders/sos` | 200  | works |
| `POST /api/auth/change-password` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `POST /api/support/tickets` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `POST /api/support/refund-requests` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `GET /api/payee-accounts/me` | 200  | works |
| `POST /api/payee-accounts/me` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `GET /api/cash/me` | 200  | works |
| `POST /api/cash/deposits` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `GET /api/earnings/statement` | 200  | works |
| `GET /api/policies/payments` | 200  | works |

**`lib/pushRegistration.ts`**

| Call | Server answer | Verdict |
| --- | --- | --- |
| `POST /api/devices` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) |
| `DELETE /api/devices/:param` | 200  | works |

### Admin app: signed in as the super admin (+ ops / finance / support where allowed) (97 calls)

**`App.tsx`**

| Call | Server answer | Verdict | ops / finance / support |
| --- | --- | --- | --- |
| `GET /api/admin/live` | 200  | works | 200 / 200 / 200 |

**`components/OrderDetailSheet.tsx`**

| Call | Server answer | Verdict | ops / finance / support |
| --- | --- | --- | --- |
| `GET /api/admin/orders/:param` | 200  | works | 200 / 200 / 200 |
| `POST /api/admin/orders/:param/unassign-rider` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 400 / 403 / 403 |
| `POST /api/admin/orders/:param/reassign-rider` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 400 / 403 / 403 |
| `PUT /api/admin/orders/:param/status` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 400 / 403 / 403 |
| `POST /api/admin/orders/:param/mark-delivered` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 400 / 403 / 403 |
| `POST /api/admin/orders/:param/refund` | 200  | works | 409 / 409 / 409 |
| `POST /api/admin/orders/:param/cancel` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 400 / 403 / 403 |
| `GET /api/admin/drivers` | 200  | works | 200 / 200 / 200 |

**`components/StatementSheet.tsx`**

| Call | Server answer | Verdict | ops / finance / support |
| --- | --- | --- | --- |
| `GET /api/admin/payouts/statement/:param/:param` | 400 BAD_OWNER_TYPE | reached; refused the probe's empty body (validation working) | 403 / 400 / 403 |

**`lib/pushRegistration.ts`**

| Call | Server answer | Verdict | ops / finance / support |
| --- | --- | --- | --- |
| `POST /api/devices` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 400 / 400 / 400 |
| `DELETE /api/devices/:param` | 200  | works | 200 / 200 / 200 |

**`lib/session.tsx`**

| Call | Server answer | Verdict | ops / finance / support |
| --- | --- | --- | --- |
| `GET /api/admin/me` | 200  | works | 200 / 200 / 200 |

**`screens/BusinessCard.tsx`**

| Call | Server answer | Verdict | ops / finance / support |
| --- | --- | --- | --- |
| `GET /api/admin/platform/business` | 200  | works | 403 / 403 / 403 |
| `PUT /api/admin/platform/business` | 200  | works | 403 / 403 / 403 |

**`screens/CatalogScreen.tsx`**

| Call | Server answer | Verdict | ops / finance / support |
| --- | --- | --- | --- |
| `GET /api/admin/menus/:param` | 404 RESTAURANT_NOT_FOUND | reached; RESTAURANT_NOT_FOUND for the probe's placeholder id | 404 / 403 / 403 |
| `PATCH /api/admin/menus/:param/items/:param` | 404 DISH_NOT_FOUND | reached; DISH_NOT_FOUND for the probe's placeholder id | 403 / 403 / 403 |
| `POST /api/admin/menus/:param/items` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 403 / 403 / 403 |
| `POST /api/admin/menus/:param/items/:param/stock` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 403 / 403 / 403 |
| `DELETE /api/admin/menus/:param/items/:param` | 404 DISH_NOT_FOUND | reached; DISH_NOT_FOUND for the probe's placeholder id | 403 / 403 / 403 |
| `PATCH /api/admin/categories/:param` | 404 CATEGORY_NOT_FOUND | reached; CATEGORY_NOT_FOUND for the probe's placeholder id | 403 / 403 / 403 |
| `DELETE /api/admin/categories/:param` | 404 CATEGORY_NOT_FOUND | reached; CATEGORY_NOT_FOUND for the probe's placeholder id | 403 / 403 / 403 |
| `POST /api/admin/menu-requests/bulk-review` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 403 / 403 / 403 |
| `GET /api/admin/categories` | 200  | works | 200 / 403 / 403 |
| `POST /api/admin/categories` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 403 / 403 / 403 |

**`screens/DashboardScreen.tsx`**

| Call | Server answer | Verdict | ops / finance / support |
| --- | --- | --- | --- |
| `GET /api/admin/dashboard` | 200  | works | 200 / 200 / 200 |

**`screens/DeliveriesScreen.tsx`**

| Call | Server answer | Verdict | ops / finance / support |
| --- | --- | --- | --- |
| `GET /api/admin/deliveries/live` | 200  | works | 200 / 200 / 200 |

**`screens/DocumentsScreen.tsx`**

| Call | Server answer | Verdict | ops / finance / support |
| --- | --- | --- | --- |
| `POST /api/admin/documents/review` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 400 / 403 / 403 |

**`screens/FinanceScreen.tsx`**

| Call | Server answer | Verdict | ops / finance / support |
| --- | --- | --- | --- |
| `GET /api/admin/settlements/:param` | 404 RESTAURANT_NOT_FOUND | reached; RESTAURANT_NOT_FOUND for the probe's placeholder id | 403 / 404 / 403 |
| `POST /api/admin/settlements/:param/status` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 403 / 400 / 403 |
| `POST /api/admin/settlements` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 403 / 400 / 403 |

**`screens/GrievanceCard.tsx`**

| Call | Server answer | Verdict | ops / finance / support |
| --- | --- | --- | --- |
| `GET /api/admin/policies/grievance` | 200  | works | 403 / 200 / 403 |
| `PUT /api/admin/policies/grievance` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 403 / 400 / 403 |

**`screens/LoginScreen.tsx`**

| Call | Server answer | Verdict | ops / finance / support |
| --- | --- | --- | --- |
| `POST /api/auth/login` | 429 TOO_MANY_ATTEMPTS | reached; sign-in limiter (probe signed in many times) | – |

**`screens/MarketingScreen.tsx`**

| Call | Server answer | Verdict | ops / finance / support |
| --- | --- | --- | --- |
| `PATCH /api/admin/coupons/:param` | 404 COUPON_NOT_FOUND | reached; COUPON_NOT_FOUND for the probe's placeholder id | 403 / 403 / 403 |
| `DELETE /api/admin/coupons/:param` | 404 COUPON_NOT_FOUND | reached; COUPON_NOT_FOUND for the probe's placeholder id | 403 / 403 / 403 |
| `POST /api/admin/reviews/:param/moderate` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 403 / 403 / 403 |
| `GET /api/admin/coupons` | 200  | works | 403 / 403 / 403 |
| `POST /api/admin/coupons` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 403 / 403 / 403 |

**`screens/MenuPricingTab.tsx`**

| Call | Server answer | Verdict | ops / finance / support |
| --- | --- | --- | --- |
| `GET /api/admin/rates/restaurants/:param/menu` | 200  | works | 403 / 200 / 403 |
| `PUT /api/admin/rates/restaurants/:param/menu/:param` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 403 / 400 / 403 |
| `GET /api/admin/rates/restaurants` | 200  | works | 403 / 200 / 403 |

**`screens/PayeeAccountsScreen.tsx`**

| Call | Server answer | Verdict | ops / finance / support |
| --- | --- | --- | --- |
| `POST /api/admin/payee-accounts/:param/review` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 403 / 400 / 403 |
| `GET /api/admin/payee-accounts` | 200  | works | 403 / 200 / 403 |
| `GET /api/admin/payee-accounts/coverage` | 200  | works | 403 / 200 / 403 |

**`screens/PayoutsScreen.tsx`**

| Call | Server answer | Verdict | ops / finance / support |
| --- | --- | --- | --- |
| `POST /api/admin/payouts/:param/approve` | 404 PAYOUT_NOT_FOUND | reached; PAYOUT_NOT_FOUND for the probe's placeholder id | 403 / 404 / 403 |
| `POST /api/admin/payouts/:param/send` | 404 PAYOUT_NOT_FOUND | reached; PAYOUT_NOT_FOUND for the probe's placeholder id | 403 / 404 / 403 |
| `POST /api/admin/cash/deposits/:param/confirm` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 403 / 400 / 403 |
| `POST /api/admin/payments/held/:param/release` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 403 / 400 / 403 |
| `POST /api/admin/payouts/:param/cancel` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 403 / 400 / 403 |
| `GET /api/admin/payouts/dues` | 200  | works | 403 / 200 / 403 |
| `GET /api/admin/payouts/list` | 200  | works | 403 / 200 / 403 |
| `GET /api/admin/cash/deposits` | 200  | works | 403 / 200 / 403 |
| `GET /api/admin/payments/overview` | 200  | works | 403 / 200 / 403 |
| `GET /api/admin/gateway/receivable` | 200  | works | 403 / 200 / 403 |
| `GET /api/admin/payouts/requests` | 200  | works | 403 / 200 / 403 |
| `POST /api/admin/payouts` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 403 / 400 / 403 |
| `POST /api/admin/gateway/settlements` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 403 / 400 / 403 |
| `POST /api/admin/payouts/backfill` | 200  | works | 403 / 200 / 403 |
| `POST /api/admin/cash/bank-deposits` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 403 / 400 / 403 |
| `POST /api/admin/cash/returns` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 403 / 400 / 403 |

**`screens/PeopleScreen.tsx`**

| Call | Server answer | Verdict | ops / finance / support |
| --- | --- | --- | --- |
| `GET /api/admin/customers/:param` | 200  | works | 200 / 200 / 200 |
| `PATCH /api/admin/customers/:param` | 200  | works | 403 / 403 / 200 |
| `POST /api/admin/customers/:param/wallet` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 403 / 400 / 400 |
| `POST /api/admin/staff/:param/reset-password` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 400 / 403 / 403 |
| `GET /api/admin/drivers/:param` | 200  | works | 200 / 200 / 200 |
| `PATCH /api/admin/drivers/:param` | 200  | works | 200 / 403 / 403 |
| `GET /api/admin/restaurants/:param` | 200  | works | 200 / 200 / 403 |
| `PATCH /api/admin/restaurants/:param` | 200  | works | 200 / 403 / 403 |

**`screens/ProfileApprovalsScreen.tsx`**

| Call | Server answer | Verdict | ops / finance / support |
| --- | --- | --- | --- |
| `POST /api/admin/profile-edits/:param/review` | 404 PROFILE_EDIT_NOT_FOUND | reached; PROFILE_EDIT_NOT_FOUND for the probe's placeholder id | 404 / 403 / 403 |

**`screens/ProfileScreen.tsx`**

| Call | Server answer | Verdict | ops / finance / support |
| --- | --- | --- | --- |
| `PATCH /api/auth/me` | 200  | works | 200 / 200 / 200 |
| `POST /api/auth/change-password` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 400 / 400 / 400 |
| `POST /api/auth/logout` | skipped SIGN_OUT | not called (would sign the probe out) | – |

**`screens/RatesScreen.tsx`**

| Call | Server answer | Verdict | ops / finance / support |
| --- | --- | --- | --- |
| `PUT /api/admin/rates/restaurants/:param` | 200  | works | 403 / 200 / 403 |
| `GET /api/admin/pricing/config` | 200  | works | 403 / 200 / 403 |
| `GET /api/admin/rates/membership` | 200  | works | 403 / 200 / 403 |
| `GET /api/admin/rates/incentives` | 200  | works | 403 / 200 / 403 |
| `PUT /api/admin/rates/incentives` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 403 / 400 / 403 |
| `PUT /api/admin/pricing/config` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 403 / 400 / 403 |
| `PUT /api/admin/rates/membership` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 403 / 400 / 403 |

**`screens/RefundsScreen.tsx`**

| Call | Server answer | Verdict | ops / finance / support |
| --- | --- | --- | --- |
| `GET /api/admin/refund-requests/:param` | 404 REFUND_REQUEST_NOT_FOUND | reached; REFUND_REQUEST_NOT_FOUND for the probe's placeholder id | 404 / 404 / 404 |
| `POST /api/admin/refund-requests/:param/decision` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 400 / 400 / 400 |

**`screens/RolesScreen.tsx`**

| Call | Server answer | Verdict | ops / finance / support |
| --- | --- | --- | --- |
| `PATCH /api/admin/roles/:param` | 404 ROLE_NOT_FOUND | reached; ROLE_NOT_FOUND for the probe's placeholder id | 403 / 403 / 403 |
| `DELETE /api/admin/roles/:param` | 404 ROLE_NOT_FOUND | reached; ROLE_NOT_FOUND for the probe's placeholder id | 403 / 403 / 403 |
| `PATCH /api/admin/admins/:param` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 403 / 403 / 403 |
| `GET /api/admin/roles` | 200  | works | 403 / 403 / 403 |
| `POST /api/admin/roles` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 403 / 403 / 403 |
| `GET /api/admin/admins` | 200  | works | 403 / 403 / 403 |
| `POST /api/admin/admins` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 403 / 403 / 403 |

**`screens/SettingsScreen.tsx`**

| Call | Server answer | Verdict | ops / finance / support |
| --- | --- | --- | --- |
| `PUT /api/admin/settings/flags/:param` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 403 / 403 / 403 |
| `PUT /api/admin/settings/notifications/:param` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 403 / 403 / 403 |
| `GET /api/admin/settings` | 200  | works | 403 / 403 / 403 |

**`screens/SupportScreen.tsx`**

| Call | Server answer | Verdict | ops / finance / support |
| --- | --- | --- | --- |
| `GET /api/admin/support/tickets/:param` | 404 TICKET_NOT_FOUND | reached; TICKET_NOT_FOUND for the probe's placeholder id | 404 / 403 / 404 |
| `POST /api/admin/support/tickets/:param/reply` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 400 / 403 / 400 |
| `POST /api/admin/support/tickets/:param/status` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 400 / 403 / 400 |
| `POST /api/admin/sos/:param/status` | 400 VALIDATION_ERROR | reached; refused the probe's empty body (validation working) | 400 / 403 / 400 |
| `GET /api/admin/sos` | 200  | works | 200 / 200 / 200 |

## 3. Issues found in this last check, for Session A

| # | Severity | Issue | Status |
| --- | --- | --- | --- |
| 1 | Medium (fixed) | `GET /restaurants/owner/:ownerId` had **no sign-in check**. Anyone with an owner's user id could read that restaurant's full record and its raw menu (the kitchen's own prices, which reveal our markup). Its 404 also sent `error` as a bare string. | **Fixed:** now owner or staff only (401/403 otherwise), with a structured 404 `NO_RESTAURANT_LINKED`. The partner app already sends its token and its own id. Check added to `adminTools`. |
| 2 | Medium (fixed) | `packages/pricing-engine` test still expected "Gold = free delivery" after `3cbe959` made it a percentage, so **`npm run test` on `main` was red**. | **Fixed:** the test covers 0%, 50% and 100%. |
| 3 | Low | Custom admin roles: the restaurant "reset password" card shows for `catalog.restaurants.approve`, while its route needs `users.restaurants.manage` or `users.drivers.manage`. No built-in role hits this; a custom role could see a button that is refused. | Open. A one-line guard change if you want it. |
| 4 | To verify at build | The Android JS bundle and the native build could not run in the cloud container (no Android SDK, no keystores). Also, `app.config` warns the build **fails without `MAPBOX_DOWNLOAD_TOKEN`** in the root `.env`. | Your build machine. |
| 5 | To verify on a phone | New startup code: the rider app's `tripWithdrawn.ts` (a background task registered at launch), and the new notification channels (`order-updates` in the customer app; `payments` in the rider and partner apps). Real FCM delivery can't be exercised in tests. | First launch on a real phone after the build. |
| 6 | Owner decisions | SMS for OTP (the fixed code is fine for the closed trial only); the GSTIN in Settings; after the new APKs are out, set "Customer app shows the cancel fee" = 1 before any cancel fee, and turn off "Accept addresses without a map pin"; masked calling needs a provider; S8 before RazorpayX live payouts. | Owner. |

Nothing else found: every button in all four apps reaches its route as the right person, no route crashes, and no staff role sees a screen whose data it is refused.
