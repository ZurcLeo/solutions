// scripts/seedStickers.js
const { getSupabaseClient } = require('../backend/eloscloudapp/config/supabase');
require('dotenv').config({ path: './backend/eloscloudapp/.env' });

const stickers = [
  {
    name: 'Coração de Ouro',
    image_url: 'https://api.dicebear.com/7.x/icons/svg?seed=heart&backgroundColor=ffdf00',
    eloscoin_price: 10,
    rarity: 'rare',
    edition_type: 'open'
  },
  {
    name: 'Estrela Elos',
    image_url: 'https://api.dicebear.com/7.x/icons/svg?seed=star&backgroundColor=6366f1',
    eloscoin_price: 5,
    rarity: 'common',
    edition_type: 'open'
  },
  {
    name: 'Fogo da Comunidade',
    image_url: 'https://api.dicebear.com/7.x/icons/svg?seed=fire&backgroundColor=ef4444',
    eloscoin_price: 25,
    rarity: 'epic',
    edition_type: 'quantity_limited',
    max_quantity: 100
  }
];

async function seed() {
  const supabase = getSupabaseClient();
  if (!supabase) {
    console.error('Supabase client not available');
    return;
  }

  console.log('Seeding stickers...');
  const { data, error } = await supabase
    .from('sticker_catalog')
    .upsert(stickers, { onConflict: 'name' });

  if (error) {
    console.error('Error seeding stickers:', error);
  } else {
    console.log('Stickers seeded successfully!');
  }
}

seed();
