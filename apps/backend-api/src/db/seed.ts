import bcrypt from 'bcryptjs';
import { userRepository } from './repositories/userRepository.ts';
import { restaurantRepository } from './repositories/restaurantRepository.ts';
import { menuRepository } from './repositories/menuRepository.ts';
import { riderRepository } from './repositories/riderRepository.ts';
import { walletRepository } from './repositories/walletRepository.ts';
import { kycRepository } from './repositories/kycRepository.ts';
import { memoryStore } from './client.ts';

console.log('====================================================');
console.log('       QUICK BITE PLATFORM - MULTI-DEVICE SEED      ');
console.log('====================================================\n');

export async function seedDatabase() {
  console.log('Seeding role-based authentication accounts...');

  const defaultPasswordHash = await bcrypt.hash('pass123', 10);

  // 1. Users for each of the 4 Devices
  await userRepository.create({
    id: 'usr_admin_01',
    email: 'admin@quickbite.app',
    passwordHash: defaultPasswordHash,
    fullName: 'Ananya Iyer',
    role: 'admin',
    isGold: true,
    preferredLanguage: 'en',
    createdAt: new Date().toISOString()
  });

  await userRepository.create({
    id: 'usr_partner_01',
    email: 'partner@quickbite.app',
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
    passwordHash: defaultPasswordHash,
    fullName: 'Rahul Sharma',
    role: 'customer',
    isGold: true,
    preferredLanguage: 'kn',
    createdAt: new Date().toISOString()
  });

  console.log('[PASS] Core accounts seeded (Admin, Partner, Rider, Customer - password: pass123)');

  // 2. Wallets & Initial Balances
  await walletRepository.credit('usr_customer_01', 500.00, 'Welcome Promotional Wallet Balance');
  await walletRepository.credit('usr_rider_01', 240.00, 'Shift Earnings Balance');
  console.log('[PASS] Customer wallet (Rs 500) and Rider wallet (Rs 240) seeded.');

  // 3. Delivery Rider Profile
  await riderRepository.create({
    id: 'rdr_vikram_01',
    userId: 'usr_rider_01',
    fullName: 'Vikram Singh',
    phone: '+91-98765-11223',
    vehicleType: 'BIKE',
    licenseNumber: 'KA032021008899',
    vehicleRcNumber: 'KA04EJ4321',
    kycStatus: 'ACTIVE',
    isOnline: true,
    currentCoordinates: { latitude: 12.9720, longitude: 77.6400 }
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
    addressLine: '100 Feet Road, Indiranagar',
    city: 'Bengaluru',
    pincode: '560038',
    coordinates: { latitude: 12.9716, longitude: 77.6412 },
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
    addressLine: '80 Feet Road, Koramangala 4th Block',
    city: 'Bengaluru',
    pincode: '560034',
    coordinates: { latitude: 12.9352, longitude: 77.6245 },
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
    addressLine: '12th Main, HAL 2nd Stage, Indiranagar',
    city: 'Bengaluru',
    pincode: '560038',
    coordinates: { latitude: 12.9690, longitude: 77.6450 },
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
    addressLine: '5th Block, Koramangala',
    city: 'Bengaluru',
    pincode: '560095',
    coordinates: { latitude: 12.9340, longitude: 77.6180 },
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
    addressLine: 'Flat 402, Green Glen Towers, 100 Feet Road',
    landmark: 'Opposite Indiranagar Metro',
    city: 'Bengaluru',
    pincode: '560038',
    coordinates: { latitude: 12.9716, longitude: 77.6412 },
    isDefault: true,
    createdAt: new Date().toISOString()
  });
  memoryStore.addresses.set('addr_sample_01', {
    id: 'addr_sample_01',
    userId: 'usr_customer_01',
    label: 'Work',
    addressLine: 'WeWork Galaxy, 43 Residency Road',
    landmark: 'Near Mayo Hall',
    city: 'Bengaluru',
    pincode: '560025',
    coordinates: { latitude: 12.9698, longitude: 77.5986 },
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
    entityAddress: '100 Feet Road, Indiranagar',
    entityCity: 'Bengaluru',
    entityPhone: '+91-98765-43210',
    fileUrl: 'https://assets.quickbite.app/kyc/fssai-sample-license.jpg'
  });

  await kycRepository.submitDocument({
    entityType: 'RIDER',
    entityId: 'rdr_vikram_01',
    entityName: 'Vikram Singh',
    documentType: 'DRIVING_LICENSE',
    documentNumber: 'KA03 2021 0008899',
    entityCity: 'Bengaluru',
    entityPhone: '+91-98765-11223',
    fileUrl: 'https://assets.quickbite.app/kyc/dl-sample-license.jpg'
  });
  console.log('[PASS] Demo KYC documents seeded for Admin review queue.');

  // 7. Active Promo Coupons
  memoryStore.coupons.set('WELCOME50', {
    code: 'WELCOME50',
    discountType: 'PERCENTAGE',
    discountValue: 50,
    maxDiscountCap: 100,
    minOrderValue: 200,
    isActive: true
  });

  memoryStore.coupons.set('FREEDEL', {
    code: 'FREEDEL',
    discountType: 'FREE_DELIVERY',
    discountValue: 100,
    minOrderValue: 150,
    isActive: true
  });
  console.log('[PASS] Promo coupons seeded (WELCOME50, FREEDEL)');

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
