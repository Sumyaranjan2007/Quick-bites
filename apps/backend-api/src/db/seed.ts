import { userRepository } from './repositories/userRepository.ts';
import { restaurantRepository } from './repositories/restaurantRepository.ts';
import { menuRepository } from './repositories/menuRepository.ts';
import { memoryStore } from './client.ts';

console.log('====================================================');
console.log('       QUICK BITE PLATFORM - DATABASE SEED          ');
console.log('====================================================\n');

export async function seedDatabase() {
  console.log('Seeding demo accounts (Admins, Partners, Customers)...');

  // 1. Users
  await userRepository.create({
    id: 'usr_admin_01',
    email: 'admin@quickbite.app',
    fullName: 'Ananya Iyer',
    role: 'super_admin',
    isGold: true,
    preferredLanguage: 'en',
    createdAt: new Date().toISOString()
  });

  await userRepository.create({
    id: 'usr_partner_01',
    email: 'sunita.partner@quickbite.app',
    fullName: 'Sunita Deshmukh',
    role: 'restaurant_owner',
    isGold: false,
    preferredLanguage: 'hi',
    createdAt: new Date().toISOString()
  });

  await userRepository.create({
    id: 'usr_customer_01',
    email: 'rahul.sharma@quickbite.app',
    fullName: 'Rahul Sharma',
    role: 'customer',
    isGold: true, // Quick Bite Gold Subscriber
    preferredLanguage: 'kn',
    createdAt: new Date().toISOString()
  });

  console.log('[PASS] Users seeded (1 Admin, 1 Partner, 1 Gold Customer)');

  // 2. Restaurants in Bengaluru (Indiranagar & Koramangala)
  console.log('Seeding verified restaurants with PostGIS coordinates...');

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
    ratingAverage: 4.8,
    ratingCount: 520,
    cuisineTags: ['Biryani', 'Mughlai', 'North Indian']
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
    ratingAverage: 4.6,
    ratingCount: 840,
    cuisineTags: ['South Indian', 'Pure Veg', 'Breakfast', 'Dosa']
  });

  console.log('[PASS] Restaurants seeded (Bangalore Biryani House, Udupi Sri Krishna Bhavan)');

  // 3. Menus for Restaurants
  console.log('Seeding restaurant menus with customization option groups...');

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
            description: 'Fragrant basmati rice layered with slow-cooked spiced chicken and caramelised onions.',
            price: 320.00,
            isVeg: false,
            isAvailable: true,
            imageUrl: 'https://assets.quickbite.app/dishes/chicken-biryani.webp',
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
                title: 'Add-ons',
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
            id: 'dish_pbm',
            name: 'Paneer Butter Masala',
            description: 'Fresh cottage cheese cooked in creamy tomato gravy with rich butter.',
            price: 260.00,
            isVeg: true,
            isAvailable: true,
            imageUrl: 'https://assets.quickbite.app/dishes/paneer-butter-masala.webp'
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
            name: 'Benne Masala Dosa',
            description: 'Crispy golden crepe with generous dollops of Davangere butter, potato palya, and coconut chutney.',
            price: 110.00,
            isVeg: true,
            isAvailable: true,
            imageUrl: 'https://assets.quickbite.app/dishes/masala-dosa.webp'
          },
          {
            id: 'dish_idli_vada',
            name: 'Ghee Idli Vada Combo',
            description: 'Two steamed button idlis and one crispy medu vada served with hot piping sambar.',
            price: 90.00,
            isVeg: true,
            isAvailable: true,
            imageUrl: 'https://assets.quickbite.app/dishes/idli-vada.webp'
          }
        ]
      }
    ]
  });

  console.log('[PASS] Categorized menus and dishes seeded.');

  // 4. Coupons
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
  console.log('   DATABASE SEED COMPLETE - ALL DATA IN MEMORY      ');
  console.log('====================================================\n');
}

// Execute directly if run via CLI
seedDatabase().catch(err => {
  console.error('[FAIL] Seed failed:', err);
  process.exit(1);
});
