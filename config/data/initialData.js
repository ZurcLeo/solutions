// data/initialData.js atualizado
const roles = {
    'client': {
        id: 'client',
        name: 'Client',
        description: 'Usuário básico da plataforma',
        isSystemRole: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'admin': {
        id: 'admin',
        name: 'Admin',
        description: 'Administrador do sistema com acesso completo',
        isSystemRole: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'support': {
        id: 'support',
        name: 'Support',
        description: 'Equipe de suporte com acesso limitado a funções administrativas',
        isSystemRole: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'seller': {
        id: 'seller',
        name: 'Seller',
        description: 'Vendedor com acesso ao marketplace',
        isSystemRole: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'caixinhaManager': {
        id: 'caixinhaManager',
        name: 'CaixinhaManager',
        description: 'Administrador de uma caixinha específica',
        isSystemRole: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'caixinhaMember': {
        id: 'caixinhaMember',
        name: 'CaixinhaMember',
        description: 'Membro de uma caixinha específica',
        isSystemRole: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'caixinhaModerator': {
        id: 'caixinhaModerator',
        name: 'CaixinhaModerator',
        description: 'Moderador de uma caixinha específica',
        isSystemRole: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    }
};

const permissions = {
    // Permissões existentes
    'admin:access': {
        id: 'admin:access',
        name: 'admin:access',
        description: 'Acesso ao painel administrativo',
        resource: 'admin',
        action: 'access',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'role:create': {
        id: 'role:create',
        name: 'role:create',
        description: 'Criar roles no sistema',
        resource: 'role',
        action: 'create',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'role:read': {
        id: 'role:read',
        name: 'role:read',
        description: 'Visualizar roles do sistema',
        resource: 'role',
        action: 'read',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'role:update': {
        id: 'role:update',
        name: 'role:update',
        description: 'Atualizar roles do sistema',
        resource: 'role',
        action: 'update',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'role:delete': {
        id: 'role:delete',
        name: 'role:delete',
        description: 'Remover roles do sistema',
        resource: 'role',
        action: 'delete',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'user:read': {
        id: 'user:read',
        name: 'user:read',
        description: 'Visualizar informações de usuários',
        resource: 'user',
        action: 'read',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'user:update': {
        id: 'user:update',
        name: 'user:update',
        description: 'Atualizar informações de usuários',
        resource: 'user',
        action: 'update',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'permission:create': {
        id: 'permission:create',
        name: 'permission:create',
        description: 'Criar permissões no sistema',
        resource: 'permission',
        action: 'create',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'permission:read': {
        id: 'permission:read',
        name: 'permission:read',
        description: 'Visualizar permissões do sistema',
        resource: 'permission',
        action: 'read',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'permission:update': {
        id: 'permission:update',
        name: 'permission:update',
        description: 'Atualizar permissões do sistema',
        resource: 'permission',
        action: 'update',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'permission:delete': {
        id: 'permission:delete',
        name: 'permission:delete',
        description: 'Remover permissões do sistema',
        resource: 'permission',
        action: 'delete',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    
    // Novas permissões do initializeDefaultPermissions
    'user:create': {
        id: 'user:create',
        name: 'user:create',
        description: 'Criar usuários',
        resource: 'user',
        action: 'create',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'user:delete': {
        id: 'user:delete',
        name: 'user:delete',
        description: 'Remover usuários',
        resource: 'user',
        action: 'delete',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'caixinha:create': {
        id: 'caixinha:create',
        name: 'caixinha:create',
        description: 'Criar caixinha',
        resource: 'caixinha',
        action: 'create',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'caixinha:read': {
        id: 'caixinha:read',
        name: 'caixinha:read',
        description: 'Visualizar caixinha',
        resource: 'caixinha',
        action: 'read',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'caixinha:update': {
        id: 'caixinha:update',
        name: 'caixinha:update',
        description: 'Atualizar caixinha',
        resource: 'caixinha',
        action: 'update',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'caixinha:delete': {
        id: 'caixinha:delete',
        name: 'caixinha:delete',
        description: 'Remover caixinha',
        resource: 'caixinha',
        action: 'delete',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'caixinha:manage_members': {
        id: 'caixinha:manage_members',
        name: 'caixinha:manage_members',
        description: 'Gerenciar membros de caixinha',
        resource: 'caixinha',
        action: 'manage_members',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'caixinha:manage_loans': {
        id: 'caixinha:manage_loans',
        name: 'caixinha:manage_loans',
        description: 'Gerenciar empréstimos de caixinha',
        resource: 'caixinha',
        action: 'manage_loans',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'caixinha:view_reports': {
        id: 'caixinha:view_reports',
        name: 'caixinha:view_reports',
        description: 'Visualizar relatórios de caixinha',
        resource: 'caixinha',
        action: 'view_reports',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'product:create': {
        id: 'product:create',
        name: 'product:create',
        description: 'Criar produto',
        resource: 'product',
        action: 'create',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'product:read': {
        id: 'product:read',
        name: 'product:read',
        description: 'Visualizar produto',
        resource: 'product',
        action: 'read',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'product:update': {
        id: 'product:update',
        name: 'product:update',
        description: 'Atualizar produto',
        resource: 'product',
        action: 'update',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'product:delete': {
        id: 'product:delete',
        name: 'product:delete',
        description: 'Remover produto',
        resource: 'product',
        action: 'delete',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'order:create': {
        id: 'order:create',
        name: 'order:create',
        description: 'Criar pedido',
        resource: 'order',
        action: 'create',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'order:read': {
        id: 'order:read',
        name: 'order:read',
        description: 'Visualizar pedido',
        resource: 'order',
        action: 'read',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'order:update': {
        id: 'order:update',
        name: 'order:update',
        description: 'Atualizar pedido',
        resource: 'order',
        action: 'update',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'order:cancel': {
        id: 'order:cancel',
        name: 'order:cancel',
        description: 'Cancelar pedido',
        resource: 'order',
        action: 'cancel',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'support:access': {
        id: 'support:access',
        name: 'support:access',
        description: 'Acesso ao painel de suporte',
        resource: 'support',
        action: 'access',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'support:manage_tickets': {
        id: 'support:manage_tickets',
        name: 'support:manage_tickets',
        description: 'Gerenciar tickets de suporte',
        resource: 'support',
        action: 'manage_tickets',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    },
    'support:view_logs': {
        id: 'support:view_logs',
        name: 'support:view_logs',
        description: 'Visualizar logs do sistema',
        resource: 'support',
        action: 'view_logs',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    }
};

const rolePermissions = {
    // Permissões existentes
    'client_user:read': {
        roleId: 'client',
        permissionId: 'user:read',
        createdAt: new Date().toISOString()
    },
    'client_user:update': {
        roleId: 'client',
        permissionId: 'user:update',
        createdAt: new Date().toISOString()
    },
    'admin_admin:access': {
        roleId: 'admin',
        permissionId: 'admin:access',
        createdAt: new Date().toISOString()
    },    
    'admin_role:read': {
        roleId: 'admin',
        permissionId: 'role:read',
        createdAt: new Date().toISOString()
    },
    'admin_role:create': {
        roleId: 'admin',
        permissionId: 'role:create',
        createdAt: new Date().toISOString()
    },
    'admin_role:update': {
        roleId: 'admin',
        permissionId: 'role:update',
        createdAt: new Date().toISOString()
    },
    'admin_role:delete': {
        roleId: 'admin',
        permissionId: 'role:delete',
        createdAt: new Date().toISOString()
    },
    'admin_permission:read': {
        roleId: 'admin',
        permissionId: 'permission:read',
        createdAt: new Date().toISOString()
    },
    'admin_permission:create': {
        roleId: 'admin',
        permissionId: 'permission:create',
        createdAt: new Date().toISOString()
    },
    'admin_permission:update': {
        roleId: 'admin',
        permissionId: 'permission:update',
        createdAt: new Date().toISOString()
    },
    'admin_permission:delete': {
        roleId: 'admin',
        permissionId: 'permission:delete',
        createdAt: new Date().toISOString()
    },
    
    // Novas permissões para Client
    'client_caixinha:read': {
        roleId: 'client',
        permissionId: 'caixinha:read',
        createdAt: new Date().toISOString()
    },
    'client_product:read': {
        roleId: 'client',
        permissionId: 'product:read',
        createdAt: new Date().toISOString()
    },
    'client_order:create': {
        roleId: 'client',
        permissionId: 'order:create',
        createdAt: new Date().toISOString()
    },
    'client_order:read': {
        roleId: 'client',
        permissionId: 'order:read',
        createdAt: new Date().toISOString()
    },

    // Permissões para Seller
    'seller_product:create': {
        roleId: 'seller',
        permissionId: 'product:create',
        createdAt: new Date().toISOString()
    },
    'seller_product:read': {
        roleId: 'seller',
        permissionId: 'product:read',
        createdAt: new Date().toISOString()
    },
    'seller_product:update': {
        roleId: 'seller',
        permissionId: 'product:update',
        createdAt: new Date().toISOString()
    },
    'seller_product:delete': {
        roleId: 'seller',
        permissionId: 'product:delete',
        createdAt: new Date().toISOString()
    },
    'seller_order:read': {
        roleId: 'seller',
        permissionId: 'order:read',
        createdAt: new Date().toISOString()
    },
    'seller_order:update': {
        roleId: 'seller',
        permissionId: 'order:update',
        createdAt: new Date().toISOString()
    },

    // Permissões para Support
    'support_support:access': {
        roleId: 'support',
        permissionId: 'support:access',
        createdAt: new Date().toISOString()
    },
    'support_support:manage_tickets': {
        roleId: 'support',
        permissionId: 'support:manage_tickets',
        createdAt: new Date().toISOString()
    },
    'support_support:view_logs': {
        roleId: 'support',
        permissionId: 'support:view_logs',
        createdAt: new Date().toISOString()
    },
    'support_user:read': {
        roleId: 'support',
        permissionId: 'user:read',
        createdAt: new Date().toISOString()
    },
    'support_caixinha:read': {
        roleId: 'support',
        permissionId: 'caixinha:read',
        createdAt: new Date().toISOString()
    },
    'support_product:read': {
        roleId: 'support',
        permissionId: 'product:read',
        createdAt: new Date().toISOString()
    },
    'support_order:read': {
        roleId: 'support',
        permissionId: 'order:read',
        createdAt: new Date().toISOString()
    },

    // Permissões para CaixinhaManager
    'caixinhaManager_caixinha:read': {
        roleId: 'caixinhaManager',
        permissionId: 'caixinha:read',
        createdAt: new Date().toISOString()
    },
    'caixinhaManager_caixinha:update': {
        roleId: 'caixinhaManager',
        permissionId: 'caixinha:update',
        createdAt: new Date().toISOString()
    },
    'caixinhaManager_caixinha:delete': {
        roleId: 'caixinhaManager',
        permissionId: 'caixinha:delete',
        createdAt: new Date().toISOString()
    },
    'caixinhaManager_caixinha:manage_members': {
        roleId: 'caixinhaManager',
        permissionId: 'caixinha:manage_members',
        createdAt: new Date().toISOString()
    },
    'caixinhaManager_caixinha:manage_loans': {
        roleId: 'caixinhaManager',
        permissionId: 'caixinha:manage_loans',
        createdAt: new Date().toISOString()
    },
    'caixinhaManager_caixinha:view_reports': {
        roleId: 'caixinhaManager',
        permissionId: 'caixinha:view_reports',
        createdAt: new Date().toISOString()
    },

    // Permissões para CaixinhaMember
    'caixinhaMember_caixinha:read': {
        roleId: 'caixinhaMember',
        permissionId: 'caixinha:read',
        createdAt: new Date().toISOString()
    },

    // Permissões para CaixinhaModerator
    'caixinhaModerator_caixinha:read': {
        roleId: 'caixinhaModerator',
        permissionId: 'caixinha:read',
        createdAt: new Date().toISOString()
    },
    'caixinhaModerator_caixinha:manage_members': {
        roleId: 'caixinhaModerator',
        permissionId: 'caixinha:manage_members',
        createdAt: new Date().toISOString()
    },
    'caixinhaModerator_caixinha:view_reports': {
        roleId: 'caixinhaModerator',
        permissionId: 'caixinha:view_reports',
        createdAt: new Date().toISOString()
    }
};

module.exports = {
    roles,
    permissions,
    rolePermissions
};