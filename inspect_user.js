const { getFirestore } = require('./firebaseAdmin');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectUser(userId) {
  const db = getFirestore();
  
  // 1. Check Firestore
  const userDoc = await db.collection('usuario').doc(userId).get();
  const userData = userDoc.data();
  console.log('--- FIRESTORE ---');
  console.log('isOwnerOrAdmin:', userData.isOwnerOrAdmin);
  console.log('Roles Object Keys:', Object.keys(userData.roles || {}));
  console.log('Roles Data:', JSON.stringify(userData.roles, null, 2));

  // 2. Check Supabase
  const { data: supabaseRoles, error } = await supabase
    .from('user_roles')
    .select('*, roles(name)')
    .eq('user_id', userId);

  console.log('\n--- SUPABASE ---');
  if (error) {
    console.error('Error:', error);
  } else {
    console.log('Roles Count:', supabaseRoles.length);
    console.log('Roles List:', supabaseRoles.map(r => ({ 
      id: r.role_id, 
      name: r.roles.name,
      granted_at: r.granted_at 
    })));
  }
}

const userId = 'sS855lp9DwhZodxMqG7bf5cYeQ92';
inspectUser(userId).then(() => process.exit(0)).catch(console.error);
