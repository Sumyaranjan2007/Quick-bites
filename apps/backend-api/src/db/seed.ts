import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { config } from '../config/env.ts';
import { userRepository } from './repositories/userRepository.ts';
import { restaurantRepository } from './repositories/restaurantRepository.ts';
import { menuRepository } from './repositories/menuRepository.ts';
import { riderRepository } from './repositories/riderRepository.ts';
import { walletRepository } from './repositories/walletRepository.ts';
import { kycRepository } from './repositories/kycRepository.ts';
import { memoryStore } from './client.ts';
import { SEED_RIDER_PHOTO, SEED_RIDER_LICENCE_SCAN, SEED_RIDER_RC_SCAN } from './seedAssets.ts';
import { adminRoleRepository } from './repositories/adminRoleRepository.ts';
import { categoryRepository } from './repositories/categoryRepository.ts';

console.log('====================================================');
console.log('       QUICK BITE PLATFORM - MULTI-DEVICE SEED      ');
console.log('====================================================\n');

/**
 * Bump this whenever the seed's contents change.
 *
 * A snapshot on disk is loaded in preference to re-seeding, so without a marker
 * an old snapshot silently wins and edits to this file never reach a running
 * deployment. The stamp lets startup notice the mismatch and re-seed.
 */
export const SEED_VERSION = '2026-09-14-admin-console-rbac';

/**
 * The seed creates staff, partner and rider accounts. Locally they share the well-known
 * password `pass123`, which is convenient and harmless. In production it is a published
 * backdoor: the value sits in this file, in a public repository, alongside the account
 * addresses — so `admin@quickbite.app` would be an open administrator login on the live
 * deployment.
 *
 * In production the password must be supplied out of band. If it is not, we seed an
 * unguessable random one instead, so the demo accounts exist but nobody can sign in to
 * them until an operator deliberately sets a password.
 */
function resolveSeedPassword(): string {
  if (!config.IS_PRODUCTION) return 'pass123';

  const supplied = process.env.SEED_DEFAULT_PASSWORD;
  if (supplied && supplied.length >= 12) return supplied;

  console.warn(
    '[seed] SEED_DEFAULT_PASSWORD is unset or too short. Seeded accounts are being given ' +
      'a random password and cannot be signed into. Set SEED_DEFAULT_PASSWORD (12+ chars) ' +
      'to provision them.'
  );
  return crypto.randomBytes(32).toString('hex');
}

export async function seedDatabase() {
  console.log('Seeding role-based authentication accounts...');

  const defaultPasswordHash = await bcrypt.hash(resolveSeedPassword(), 10);

  // 1. Users for each of the 4 Devices
  // The roles have to exist before any account can be pointed at one.
  await adminRoleRepository.ensureSystemRoles();

  await userRepository.create({
    id: 'usr_admin_01',
    email: 'admin@quickbite.app',
    passwordHash: defaultPasswordHash,
    fullName: 'Ananya Iyer',
    // The platform owner. Holds every permission by virtue of the role itself,
    // which is why it is the only account that can hand roles to anybody else.
    role: 'super_admin',
    adminRoleId: 'rol_super_admin',
    isGold: true,
    preferredLanguage: 'en',
    createdAt: new Date().toISOString()
  });

  // Role-scoped staff accounts, so restricted access is something that can
  // actually be signed into and checked rather than only described.
  const scopedStaff: Array<{ id: string; email: string; fullName: string; roleId: string }> = [
    { id: 'usr_admin_ops', email: 'ops@quickbite.app', fullName: 'Rohit Menon', roleId: 'rol_operations_admin' },
    { id: 'usr_admin_fin', email: 'finance@quickbite.app', fullName: 'Priya Nair', roleId: 'rol_finance_admin' },
    { id: 'usr_admin_sup', email: 'support@quickbite.app', fullName: 'Imran Qureshi', roleId: 'rol_support_admin' }
  ];
  for (const staff of scopedStaff) {
    await userRepository.create({
      id: staff.id,
      email: staff.email,
      passwordHash: defaultPasswordHash,
      fullName: staff.fullName,
      role: 'admin',
      adminRoleId: staff.roleId,
      isGold: false,
      preferredLanguage: 'en',
      createdAt: new Date().toISOString()
    });
  }
  console.log('[PASS] Admin roles seeded with scoped staff accounts (ops, finance, support).');

  await userRepository.create({
    id: 'usr_partner_01',
    email: 'partner@quickbite.app',
    // Customers sign in by phone, so every seeded account carries one. Without
    // it the demo customer could not reach their own account at all, and a
    // staff number could not be tested against the phone sign-in route.
    phone: '9876511223',
    passwordHash: defaultPasswordHash,
    fullName: 'Sunita Deshmukh',
    role: 'restaurant_owner',
    isGold: false,
    preferredLanguage: 'en',
    createdAt: new Date().toISOString()
  });

  await userRepository.create({
    id: 'usr_partner_legacy',
    email: 'sunita.partner@quickbite.app',
    // Customers sign in by phone, so every seeded account carries one. Without
    // it the demo customer could not reach their own account at all, and a
    // staff number could not be tested against the phone sign-in route.
    phone: '9876511224',
    passwordHash: defaultPasswordHash,
    fullName: 'Sunita Deshmukh',
    role: 'restaurant_owner',
    isGold: false,
    preferredLanguage: 'en',
    createdAt: new Date().toISOString()
  });

  await userRepository.create({
    id: 'usr_rider_01',
    email: 'rider@quickbite.app',
    // Customers sign in by phone, so every seeded account carries one. Without
    // it the demo customer could not reach their own account at all, and a
    // staff number could not be tested against the phone sign-in route.
    phone: '9876543211',
    passwordHash: defaultPasswordHash,
    fullName: 'Vikram Singh',
    role: 'rider',
    isGold: false,
    preferredLanguage: 'en',
    createdAt: new Date().toISOString()
  });

  await userRepository.create({
    id: 'usr_customer_01',
    email: 'customer@quickbite.app',
    // Customers sign in by phone, so every seeded account carries one. Without
    // it the demo customer could not reach their own account at all, and a
    // staff number could not be tested against the phone sign-in route.
    phone: '9876543210',
    passwordHash: defaultPasswordHash,
    fullName: 'Rahul Sharma',
    role: 'customer',
    isGold: true,
    preferredLanguage: 'en',
    createdAt: new Date().toISOString()
  });

  await userRepository.create({
    id: 'usr_customer_legacy',
    email: 'rahul.sharma@quickbite.app',
    // Customers sign in by phone, so every seeded account carries one. Without
    // it the demo customer could not reach their own account at all, and a
    // staff number could not be tested against the phone sign-in route.
    phone: '9876543212',
    passwordHash: defaultPasswordHash,
    fullName: 'Rahul Sharma',
    role: 'customer',
    isGold: true,
    preferredLanguage: 'kn',
    createdAt: new Date().toISOString()
  });

  console.log(
    config.IS_PRODUCTION
      ? '[PASS] Core accounts seeded (password from SEED_DEFAULT_PASSWORD)'
      : '[PASS] Core accounts seeded (Admin, Partner, Rider, Customer - password: pass123)'
  );

  // 2. Wallets & Initial Balances
  await walletRepository.credit('usr_customer_01', 500.00, 'Welcome Promotional Wallet Balance');
  await walletRepository.credit('usr_rider_01', 240.00, 'Shift Earnings Balance');
  console.log('[PASS] Customer wallet (Rs 500) and Rider wallet (Rs 240) seeded.');

  // 3. Delivery Rider Profile
  //
  // Seeded complete — photograph, partner ID and approved papers — because a
  // rider is now blocked from going on shift until all of those exist. Starts
  // off shift: whether a rider is available is theirs to decide, and seeding
  // them Online put a rider on the dispatch list who was not at their handlebars.
  await riderRepository.create({
    id: 'rdr_vikram_01',
    userId: 'usr_rider_01',
    driverCode: 'QB-RID-0001',
    fullName: 'Vikram Singh',
    phone: '+91-98765-11223',
    profilePhotoUrl: SEED_RIDER_PHOTO,
    vehicleType: 'BIKE',
    licenseNumber: 'KA032021008899',
    vehicleRcNumber: 'KA04EJ4321',
    kycStatus: 'ACTIVE',
    isOnline: false,
    codCashInHand: 0,
    offersReceived: 0,
    offersAccepted: 0,
    currentCoordinates: { latitude: 12.6830, longitude: 77.4760 }
  });
  console.log('[PASS] Active Delivery Rider seeded.');

  // 4. Restaurants & Geofenced Locations (Bengaluru Hub)
  console.log('Seeding 8 authentic Indian restaurants with categorized menus...');

  const r1 = await restaurantRepository.create({
    id: 'rst_bbh_01',
    ownerId: 'usr_partner_01',
    name: 'Bangalore Biryani House',
    slug: 'bangalore-biryani-house',
    phone: '+91-98765-43210',
    addressLine: 'Kanakapura Main Road, Harohalli',
    city: 'Bengaluru',
    pincode: '562112',
    coordinates: { latitude: 12.6802, longitude: 77.4734 },
    fssaiLicenseNumber: '11223344556677',
    gstin: '29ABCDE1234F1Z5',
    isPureVeg: false,
    packagingFee: 25.00,
    status: 'ACTIVE',
    kycStatus: 'ACTIVE',
    isOpen: true,
    ratingAverage: 4.8,
    ratingCount: 520,
    cuisineTags: ['Biryani', 'Mughlai', 'North Indian'],
    bannerUrl: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=1000&auto=format&fit=crop&q=80',
    costForTwo: 400,
    highlightTag: 'Best in Biryani'
  });

  const r2 = await restaurantRepository.create({
    id: 'rst_skb_02',
    ownerId: 'usr_partner_01',
    name: 'Udupi Sri Krishna Bhavan',
    slug: 'udupi-sri-krishna-bhavan',
    phone: '+91-98765-43211',
    addressLine: 'Harohalli Industrial Area, Phase 1',
    city: 'Bengaluru',
    pincode: '562112',
    coordinates: { latitude: 12.6875, longitude: 77.4790 },
    fssaiLicenseNumber: '11223344556688',
    gstin: '29ABCDE1234F2Z4',
    isPureVeg: true,
    packagingFee: 15.00,
    status: 'ACTIVE',
    kycStatus: 'ACTIVE',
    isOpen: true,
    ratingAverage: 4.6,
    ratingCount: 840,
    cuisineTags: ['South Indian', 'Pure Veg', 'Breakfast', 'Dosa'],
    bannerUrl: 'https://images.unsplash.com/photo-1630383249896-424e482df921?w=1000&auto=format&fit=crop&q=80',
    costForTwo: 250,
    highlightTag: 'Popular Choice'
  });

  const r3 = await restaurantRepository.create({
    id: 'rst_pgt_03',
    ownerId: 'usr_partner_01',
    name: 'Punjab Grill & Tadka',
    slug: 'punjab-grill-and-tadka',
    phone: '+91-98765-43212',
    addressLine: 'Harohalli Cross, Kanakapura Road',
    city: 'Bengaluru',
    pincode: '562112',
    coordinates: { latitude: 12.6748, longitude: 77.4698 },
    fssaiLicenseNumber: '11223344556699',
    gstin: '29ABCDE1234F3Z3',
    isPureVeg: false,
    packagingFee: 20.00,
    status: 'ACTIVE',
    kycStatus: 'ACTIVE',
    isOpen: true,
    ratingAverage: 4.7,
    ratingCount: 430,
    cuisineTags: ['North Indian', 'Tandoor', 'Curries'],
    bannerUrl: 'https://images.unsplash.com/photo-1585937421612-70a008356fbe?w=1000&auto=format&fit=crop&q=80',
    costForTwo: 450,
    highlightTag: 'Gourmet Pick'
  });

  const r4 = await restaurantRepository.create({
    id: 'rst_map_04',
    ownerId: 'usr_partner_01',
    name: 'Milano Artisan Pizzeria',
    slug: 'milano-artisan-pizzeria',
    phone: '+91-98765-43213',
    addressLine: 'Bannikuppe Gate, Kanakapura Road',
    city: 'Bengaluru',
    pincode: '562112',
    coordinates: { latitude: 12.6930, longitude: 77.4812 },
    fssaiLicenseNumber: '11223344556600',
    gstin: '29ABCDE1234F4Z2',
    isPureVeg: false,
    packagingFee: 30.00,
    status: 'ACTIVE',
    kycStatus: 'ACTIVE',
    isOpen: true,
    ratingAverage: 4.9,
    ratingCount: 680,
    cuisineTags: ['Italian', 'Woodfired Pizza', 'Pasta'],
    bannerUrl: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=1000&auto=format&fit=crop&q=80',
    costForTwo: 500,
    highlightTag: 'Trending Now'
  });

  // 5. Rich Menus with Customizations
  await menuRepository.upsert({
    restaurantId: r1.id,
    categories: [
      {
        id: 'cat_biryani',
        name: 'Hyderabadi & Dum Biryani',
        sortOrder: 1,
        items: [
          {
            id: 'dish_ck_biryani',
            name: 'Special Chicken Dum Biryani',
            description: 'Fragrant long grain basmati rice layered with tender slow-cooked chicken and caramelised onions.',
            price: 320.00,
            isVeg: false,
            isAvailable: true,
            imageUrl: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=800&auto=format&fit=crop&q=80',
            optionGroups: [
              {
                id: 'grp_portion',
                title: 'Portion Size',
                isRequired: true,
                minSelections: 1,
                maxSelections: 1,
                options: [
                  { id: 'opt_regular', name: 'Regular (Serves 1)', priceDelta: 0.00 },
                  { id: 'opt_large', name: 'Large (Serves 2-3)', priceDelta: 150.00 }
                ]
              },
              {
                id: 'grp_extras',
                title: 'Add-ons & Sides',
                isRequired: false,
                minSelections: 0,
                maxSelections: 2,
                options: [
                  { id: 'opt_extra_raita', name: 'Extra Boondi Raita', priceDelta: 30.00 },
                  { id: 'opt_mirchi_salan', name: 'Extra Mirchi Ka Salan', priceDelta: 35.00 }
                ]
              }
            ]
          },
          {
            id: 'dish_mutton_biryani',
            name: 'Kolkata Shahi Mutton Biryani',
            description: 'Aromatic basmati rice cooked with succulent baby mutton, boiled egg, and golden spiced potato.',
            price: 420.00,
            isVeg: false,
            isAvailable: true,
            imageUrl: 'https://images.unsplash.com/photo-1589302168068-964664d93dc0?w=800&auto=format&fit=crop&q=80'
          },
          {
            id: 'dish_paneer_biryani',
            name: 'Royal Nizami Paneer Biryani',
            description: 'Marinated cottage cheese cubes layered with saffron infused rice and fried cashews.',
            price: 280.00,
            isVeg: true,
            isAvailable: true,
            imageUrl: 'https://images.unsplash.com/photo-1645177628172-a94c1f96e6db?w=800&auto=format&fit=crop&q=80'
          },
          {
            id: 'dish_pbm',
            name: 'Paneer Butter Masala',
            description: 'Fresh cottage cheese cooked in creamy tomato gravy with rich butter.',
            price: 260.00,
            isVeg: true,
            isAvailable: true,
            imageUrl: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=800&auto=format&fit=crop&q=80'
          }
        ]
      }
    ]
  });

  await menuRepository.upsert({
    restaurantId: r2.id,
    categories: [
      {
        id: 'cat_tiffin',
        name: 'Traditional South Indian Tiffin',
        sortOrder: 1,
        items: [
          {
            id: 'dish_masala_dosa',
            name: 'Davangere Benne Masala Dosa',
            description: 'Crispy butter crepe filled with seasoned potato mash, served with rich coconut and tomato chutneys.',
            price: 110.00,
            isVeg: true,
            isAvailable: true,
            imageUrl: 'https://images.unsplash.com/photo-1668236543090-82eba5ee5976?w=800&auto=format&fit=crop&q=80'
          },
          {
            id: 'dish_ghee_idli',
            name: 'Ghee Podi Button Idli',
            description: '14 bite-sized mini steamed rice cakes drenched in pure desi ghee and spicy gun powder.',
            price: 95.00,
            isVeg: true,
            isAvailable: true,
            imageUrl: 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?w=800&auto=format&fit=crop&q=80'
          },
          {
            id: 'dish_filter_coffee',
            name: 'Degree Filter Coffee',
            description: 'Traditional hot frothy Chikmagalur blend coffee brewed fresh in a brass davarah.',
            price: 45.00,
            isVeg: true,
            isAvailable: true,
            imageUrl: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800&auto=format&fit=crop&q=80'
          }
        ]
      }
    ]
  });

  await menuRepository.upsert({
    restaurantId: r3.id,
    categories: [
      {
        id: 'cat_north',
        name: 'Main Course & Tandoor',
        sortOrder: 1,
        items: [
          {
            id: 'dish_butter_chicken',
            name: 'Old Delhi Butter Chicken',
            description: 'Smoked tandoori chicken simmered in rich creamy butter tomato gravy.',
            price: 360.00,
            isVeg: false,
            isAvailable: true,
            imageUrl: 'https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?w=800&auto=format&fit=crop&q=80'
          },
          {
            id: 'dish_dal_makhani',
            name: 'Amritsari Dal Makhani',
            description: 'Black lentils slow cooked overnight on charcoal embers with butter and fresh cream.',
            price: 240.00,
            isVeg: true,
            isAvailable: true,
            imageUrl: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=800&auto=format&fit=crop&q=80'
          },
          {
            id: 'dish_garlic_naan',
            name: 'Butter Garlic Naan',
            description: 'Fresh tandoori bread brushed with butter and sprinkled with minced garlic.',
            price: 55.00,
            isVeg: true,
            isAvailable: true,
            imageUrl: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=800&auto=format&fit=crop&q=80'
          }
        ]
      }
    ]
  });

  await menuRepository.upsert({
    restaurantId: r4.id,
    categories: [
      {
        id: 'cat_pizza',
        name: 'Artisan Sourdough Pizzas',
        sortOrder: 1,
        items: [
          {
            id: 'dish_margherita',
            name: 'Classic Margherita Napoletana',
            description: 'San Marzano tomato sauce, fresh buffalo mozzarella, fresh basil leaves, extra virgin olive oil.',
            price: 380.00,
            isVeg: true,
            isAvailable: true,
            imageUrl: 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=800&auto=format&fit=crop&q=80'
          },
          {
            id: 'dish_pepperoni',
            name: 'Spicy Chicken Pepperoni Feast',
            description: 'Crispy sourdough base topped with spicy chicken pepperoni, smoked mozzarella, and hot honey drizzle.',
            price: 490.00,
            isVeg: false,
            isAvailable: true,
            imageUrl: 'https://images.unsplash.com/photo-1628840042765-356cda07504e?w=800&auto=format&fit=crop&q=80'
          }
        ]
      }
    ]
  });

  // Default delivery address for the demo customer
  memoryStore.addresses.set('addr_indiranagar_01', {
    id: 'addr_indiranagar_01',
    userId: 'usr_customer_01',
    label: 'Home',
    addressLine: 'No. 24, Shivanandha Layout, Harohalli',
    landmark: 'Near Harohalli Bus Stand',
    city: 'Bengaluru',
    pincode: '562112',
    coordinates: { latitude: 12.6818, longitude: 77.4751 },
    isDefault: true,
    createdAt: new Date().toISOString()
  });
  memoryStore.addresses.set('addr_sample_01', {
    id: 'addr_sample_01',
    userId: 'usr_customer_01',
    label: 'Work',
    addressLine: 'Harohalli Industrial Area, KIADB Phase 2',
    landmark: 'Opposite KIADB Phase 2 gate',
    city: 'Bengaluru',
    pincode: '562112',
    coordinates: { latitude: 12.6889, longitude: 77.4803 },
    isDefault: false,
    createdAt: new Date().toISOString()
  });
  console.log('[PASS] Customer delivery addresses seeded (Home, Work).');

  // 6. Seed Pending KYC Documents for Admin Review Demonstration
  await kycRepository.submitDocument({
    entityType: 'RESTAURANT',
    entityId: 'rst_bbh_01',
    entityName: 'Bangalore Biryani House',
    documentType: 'FSSAI',
    documentNumber: '11223344556677',
    entityAddress: 'Kanakapura Main Road, Harohalli',
    entityCity: 'Bengaluru',
    entityPhone: '+91-98765-43210',
    fileUrl: 'https://assets.quickbite.app/kyc/fssai-sample-license.jpg'
  });

  // The demo rider's papers are seeded already approved, so the account can go
  // on shift out of the box; the restaurant's FSSAI above stays pending so the
  // admin review queue still has something in it to review.
  const riderLicence = await kycRepository.submitDocument({
    entityType: 'RIDER',
    entityId: 'rdr_vikram_01',
    entityName: 'Vikram Singh',
    documentType: 'DRIVING_LICENSE',
    documentNumber: 'KA03 2021 0008899',
    entityCity: 'Bengaluru',
    entityPhone: '+91-98765-11223',
    fileUrl: SEED_RIDER_LICENCE_SCAN
  });
  await kycRepository.reviewDocument(riderLicence.id, 'APPROVED');

  const riderRc = await kycRepository.submitDocument({
    entityType: 'RIDER',
    entityId: 'rdr_vikram_01',
    entityName: 'Vikram Singh',
    documentType: 'VEHICLE_RC',
    documentNumber: 'KA04EJ4321',
    entityCity: 'Bengaluru',
    entityPhone: '+91-98765-11223',
    fileUrl: SEED_RIDER_RC_SCAN
  });
  await kycRepository.reviewDocument(riderRc.id, 'APPROVED');
  console.log('[PASS] Demo KYC documents seeded for Admin review queue.');

  // 7. Active Promo Coupons
  memoryStore.coupons.set('WELCOME50', {
    code: 'WELCOME50',
    title: 'Welcome offer',
    description: '50% off your first Quick Bites order, up to Rs 100.',
    discountType: 'PERCENTAGE',
    discountValue: 50,
    maxDiscountCap: 100,
    minOrderValue: 200,
    perUserLimit: 1,
    timesUsed: 0,
    applicableRestaurantIds: [],
    applicableCategories: [],
    isActive: true,
    createdAt: new Date().toISOString()
  });

  memoryStore.coupons.set('FREEDEL', {
    code: 'FREEDEL',
    title: 'Free delivery',
    description: 'No delivery fee on orders over Rs 150.',
    discountType: 'FREE_DELIVERY',
    discountValue: 100,
    minOrderValue: 150,
    timesUsed: 0,
    applicableRestaurantIds: [],
    applicableCategories: [],
    isActive: true,
    createdAt: new Date().toISOString()
  });
  console.log('[PASS] Promo coupons seeded (WELCOME50, FREEDEL)');

  // 8. Platform categories, so discovery and coupon targeting have something to
  // work with on a fresh deployment.
  const seedCategories = [
    'Biryani',
    'North Indian',
    'South Indian',
    'Chinese',
    'Pizza',
    'Burgers',
    'Desserts',
    'Beverages',
    'Healthy',
    'Street Food'
  ];
  for (const [index, name] of seedCategories.entries()) {
    await categoryRepository.create({ name, sortOrder: index + 1 });
  }
  console.log(`[PASS] ${seedCategories.length} platform categories seeded.`);

  memoryStore.meta.set('seedVersion', SEED_VERSION);

  console.log('\n====================================================');
  console.log('   DATABASE SEED COMPLETE - ALL 4 PORTALS READY     ');
  console.log('====================================================\n');
}

// Execute directly if run via CLI
const isDirectCli = process.argv[1] && (
  process.argv[1].endsWith('seed.ts') || 
  process.argv[1].endsWith('seed.js')
);

if (isDirectCli) {
  seedDatabase().catch(err => {
    console.error('[FAIL] Seed failed:', err);
    process.exit(1);
  });
}
