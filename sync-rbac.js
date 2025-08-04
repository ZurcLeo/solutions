#!/usr/bin/env node

// Script para sincronizar dados RBAC do arquivo JSON com o Firestore
const { getFirestore } = require('./firebaseAdmin');
const roles = require('./data/roles.json');
const permissions = require('./data/permissions.json');
const rolePermissions = require('./data/role_permissions.json');

const db = getFirestore();

async function syncRBACData() {
  console.log('Iniciando sincronização RBAC...');
  
  try {
    // 1. Sincronizar roles
    console.log('Sincronizando roles...');
    const rolesCollection = db.collection('roles');
    for (const [roleId, roleData] of Object.entries(roles)) {
      await rolesCollection.doc(roleId).set(roleData, { merge: true });
      console.log(`✓ Role ${roleId} sincronizada`);
    }
    
    // 2. Sincronizar permissions
    console.log('Sincronizando permissions...');
    const permissionsCollection = db.collection('permissions');
    for (const [permissionId, permissionData] of Object.entries(permissions)) {
      await permissionsCollection.doc(permissionId).set(permissionData, { merge: true });
      console.log(`✓ Permission ${permissionId} sincronizada`);
    }
    
    // 3. Sincronizar role_permissions
    console.log('Sincronizando role_permissions...');
    const rolePermissionsCollection = db.collection('role_permissions');
    for (const [key, rolePermissionData] of Object.entries(rolePermissions)) {
      await rolePermissionsCollection.doc(key).set(rolePermissionData, { merge: true });
      console.log(`✓ Role-Permission ${key} sincronizada`);
    }
    
    console.log('✅ Sincronização RBAC concluída com sucesso!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Erro na sincronização RBAC:', error);
    process.exit(1);
  }
}

// Executar apenas se chamado diretamente
if (require.main === module) {
  syncRBACData();
}

module.exports = { syncRBACData };