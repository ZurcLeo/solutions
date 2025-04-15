// RBACPanel.jsx - Interface administrativa simplificada para RBAC
import React, { useState, useEffect } from 'react';

// URL base da API
const API_URL = 'http://localhost:9000/api/rbac';

const RBACPanel = () => {
  // Estados para dados
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [users, setUsers] = useState([]);
  const [userRoles, setUserRoles] = useState([]);
  
  // Estados para seleção
  const [activeTab, setActiveTab] = useState('roles');
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedRole, setSelectedRole] = useState(null);
  
  // Estados para UI
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  
  // Estados para formulários
  const [newRole, setNewRole] = useState({ name: '', description: '', isSystemRole: false });
  const [newPermission, setNewPermission] = useState({ resource: '', action: '', description: '' });
  const [newUserRole, setNewUserRole] = useState({
    roleId: '',
    context: { type: 'global', resourceId: '' },
    options: { validationStatus: 'pending' }
  });

  // Funções de API
  async function fetchWithAuth(url, options = {}) {
    const token = localStorage.getItem('token');
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers
    };
    
    try {
      const response = await fetch(url, {
        ...options,
        headers
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Erro na requisição');
      }
      
      return await response.json();
    } catch (error) {
      throw error;
    }
  }

  // Carregar dados iniciais
  useEffect(() => {
    fetchRoles();
    fetchPermissions();
    fetchUsers();
  }, []);

  // Carregar roles do usuário quando selecionar um usuário
  useEffect(() => {
    if (selectedUser) {
      fetchUserRoles(selectedUser.id);
    }
  }, [selectedUser]);

  // Funções para buscar dados
  async function fetchRoles() {
    try {
      setLoading(true);
      const data = await fetchWithAuth(`${API_URL}/roles`);
      setRoles(data.data || []);
    } catch (err) {
      setError(err.message || 'Erro ao carregar roles');
    } finally {
      setLoading(false);
    }
  }

  async function fetchPermissions() {
    try {
      setLoading(true);
      const data = await fetchWithAuth(`${API_URL}/permissions`);
      setPermissions(data.data || []);
    } catch (err) {
      setError(err.message || 'Erro ao carregar permissões');
    } finally {
      setLoading(false);
    }
  }

  async function fetchUsers() {
    try {
      setLoading(true);
      const data = await fetchWithAuth('http://localhost:9000/api/users');
      setUsers(data || []);
    } catch (err) {
      setError(err.message || 'Erro ao carregar usuários');
    } finally {
      setLoading(false);
    }
  }

  async function fetchUserRoles(userId) {
    if (!userId) return;
    try {
      setLoading(true);
      const data = await fetchWithAuth(`${API_URL}/users/${userId}/roles`);
      setUserRoles(data.data || []);
    } catch (err) {
      setError(err.message || 'Erro ao carregar roles do usuário');
    } finally {
      setLoading(false);
    }
  }

  // Funções para manipular formulários
  async function handleCreateRole(e) {
    e.preventDefault();
    try {
      setLoading(true);
      const data = await fetchWithAuth(`${API_URL}/roles`, {
        method: 'POST',
        body: JSON.stringify(newRole)
      });
      
      setRoles([...roles, data.data]);
      setNewRole({ name: '', description: '', isSystemRole: false });
      showMessage('Role criada com sucesso');
    } catch (err) {
      setError(err.message || 'Erro ao criar role');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreatePermission(e) {
    e.preventDefault();
    try {
      setLoading(true);
      const permissionData = {
        ...newPermission,
        name: `${newPermission.resource}:${newPermission.action}`
      };
      
      const data = await fetchWithAuth(`${API_URL}/permissions`, {
        method: 'POST',
        body: JSON.stringify(permissionData)
      });
      
      setPermissions([...permissions, data.data]);
      setNewPermission({ resource: '', action: '', description: '' });
      showMessage('Permissão criada com sucesso');
    } catch (err) {
      setError(err.message || 'Erro ao criar permissão');
    } finally {
      setLoading(false);
    }
  }

  async function handleAssignRoleToUser(e) {
    e.preventDefault();
    if (!selectedUser) {
      setError('Selecione um usuário');
      return;
    }

    try {
      setLoading(true);
      const data = await fetchWithAuth(`${API_URL}/users/${selectedUser.id}/roles`, {
        method: 'POST',
        body: JSON.stringify(newUserRole)
      });
      
      setUserRoles([...userRoles, data.data]);
      setNewUserRole({
        roleId: '',
        context: { type: 'global', resourceId: '' },
        options: { validationStatus: 'pending' }
      });
      showMessage('Role atribuída com sucesso');
    } catch (err) {
      setError(err.message || 'Erro ao atribuir role');
    } finally {
      setLoading(false);
    }
  }

  async function handleRemoveRoleFromUser(userRoleId) {
    if (!selectedUser || !userRoleId) return;

    try {
      setLoading(true);
      await fetchWithAuth(`${API_URL}/users/${selectedUser.id}/roles/${userRoleId}`, {
        method: 'DELETE'
      });
      
      setUserRoles(userRoles.filter(ur => ur.id !== userRoleId));
      showMessage('Role removida com sucesso');
    } catch (err) {
      setError(err.message || 'Erro ao remover role');
    } finally {
      setLoading(false);
    }
  }

  async function handleAssignPermissionToRole(roleId, permissionId) {
    if (!roleId || !permissionId) return;

    try {
      setLoading(true);
      await fetchWithAuth(`${API_URL}/roles/${roleId}/permissions/${permissionId}`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      
      showMessage('Permissão atribuída com sucesso');
    } catch (err) {
      setError(err.message || 'Erro ao atribuir permissão');
    } finally {
      setLoading(false);
    }
  }

  async function handleRemovePermissionFromRole(roleId, permissionId) {
    if (!roleId || !permissionId) return;

    try {
      setLoading(true);
      await fetchWithAuth(`${API_URL}/roles/${roleId}/permissions/${permissionId}`, {
        method: 'DELETE'
      });
      
      showMessage('Permissão removida com sucesso');
    } catch (err) {
      setError(err.message || 'Erro ao remover permissão');
    } finally {
      setLoading(false);
    }
  }

  async function handleInitializeSystem() {
    try {
      setLoading(true);
      await fetchWithAuth(`${API_URL}/initialize`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      
      showMessage('Sistema RBAC inicializado com sucesso');
      // Recarregar dados
      fetchRoles();
      fetchPermissions();
    } catch (err) {
      setError(err.message || 'Erro ao inicializar sistema');
    } finally {
      setLoading(false);
    }
  }

  async function handleMigrateAdminUsers() {
    try {
      setLoading(true);
      await fetchWithAuth(`${API_URL}/migrate-admin-users`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      
      showMessage('Migração de usuários admin concluída com sucesso');
    } catch (err) {
      setError(err.message || 'Erro ao migrar usuários admin');
    } finally {
      setLoading(false);
    }
  }

  // Função auxiliar para mostrar mensagens
  function showMessage(text) {
    setMessage(text);
    setTimeout(() => setMessage(null), 3000);
  }

  // Renderização dos componentes de UI
  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '20px' }}>
      <h1 style={{ marginBottom: '20px' }}>Painel Administrativo RBAC</h1>
      
      {/* Área de alertas */}
      {loading && <div style={styles.alert.info}>Carregando...</div>}
      {error && <div style={styles.alert.danger}>{error}</div>}
      {message && <div style={styles.alert.success}>{message}</div>}
      
      {/* Botões de inicialização */}
      <div style={{ marginBottom: '20px' }}>
        <button onClick={handleInitializeSystem} style={{ ...styles.button.primary, marginRight: '10px' }}>
          Inicializar Sistema RBAC
        </button>
        <button onClick={handleMigrateAdminUsers} style={styles.button.secondary}>
          Migrar Usuários Admin
        </button>
      </div>

      {/* Abas de navegação */}
      <div style={styles.tabs.container}>
        <div style={styles.tabs.header}>
          <button 
            style={activeTab === 'roles' ? styles.tabs.active : styles.tabs.inactive} 
            onClick={() => setActiveTab('roles')}
          >
            Roles
          </button>
          <button 
            style={activeTab === 'permissions' ? styles.tabs.active : styles.tabs.inactive} 
            onClick={() => setActiveTab('permissions')}
          >
            Permissões
          </button>
          <button 
            style={activeTab === 'users' ? styles.tabs.active : styles.tabs.inactive} 
            onClick={() => setActiveTab('users')}
          >
            Usuários
          </button>
        </div>

        {/* Conteúdo da aba Roles */}
        {activeTab === 'roles' && (
          <div style={styles.tabs.content}>
            <div style={styles.flexRow}>
              <div style={styles.col50}>
                <h3>Roles Disponíveis</h3>
                <div style={styles.list.container}>
                  {roles.map(role => (
                    <div 
                      key={role.id} 
                      style={{
                        ...styles.list.item,
                        backgroundColor: selectedRole?.id === role.id ? '#e9f5ff' : 'white'
                      }}
                      onClick={() => setSelectedRole(role)}
                    >
                      <div style={styles.flexBetween}>
                        <h4 style={styles.list.title}>{role.name}</h4>
                        {role.isSystemRole && (
                          <span style={styles.badge.info}>Sistema</span>
                        )}
                      </div>
                      <p style={styles.list.desc}>{role.description}</p>
                    </div>
                  ))}
                </div>

                <h3>Nova Role</h3>
                <form onSubmit={handleCreateRole} style={styles.form.container}>
                  <div style={styles.form.group}>
                    <label style={styles.form.label}>Nome</label>
                    <input 
                      type="text" 
                      style={styles.form.input} 
                      value={newRole.name} 
                      onChange={e => setNewRole({...newRole, name: e.target.value})}
                      required
                    />
                  </div>
                  <div style={styles.form.group}>
                    <label style={styles.form.label}>Descrição</label>
                    <textarea 
                      style={styles.form.textarea} 
                      value={newRole.description} 
                      onChange={e => setNewRole({...newRole, description: e.target.value})}
                      required
                    />
                  </div>
                  <div style={styles.form.checkbox}>
                    <input 
                      type="checkbox" 
                      id="isSystemRole"
                      checked={newRole.isSystemRole} 
                      onChange={e => setNewRole({...newRole, isSystemRole: e.target.checked})}
                    />
                    <label htmlFor="isSystemRole">Role de Sistema</label>
                  </div>
                  <button type="submit" style={styles.button.primary}>Criar Role</button>
                </form>
              </div>

              <div style={styles.col50}>
                {selectedRole && (
                  <div>
                    <h3>Permissões da Role: {selectedRole.name}</h3>
                    <div style={styles.list.container}>
                      {permissions.map(permission => (
                        <div key={permission.id} style={styles.list.item}>
                          <div style={styles.flexBetween}>
                            <div>
                              <h4 style={styles.list.title}>{permission.name}</h4>
                              <p style={styles.list.desc}>{permission.description}</p>
                            </div>
                            <div>
                              <button 
                                style={{ ...styles.button.sm, ...styles.button.primary, marginRight: '5px' }}
                                onClick={() => handleAssignPermissionToRole(selectedRole.id, permission.id)}
                              >
                                Atribuir
                              </button>
                              <button 
                                style={{ ...styles.button.sm, ...styles.button.danger }}
                                onClick={() => handleRemovePermissionFromRole(selectedRole.id, permission.id)}
                              >
                                Remover
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Conteúdo da aba Permissões */}
        {activeTab === 'permissions' && (
          <div style={styles.tabs.content}>
            <div style={styles.flexRow}>
              <div style={styles.col50}>
                <h3>Permissões Disponíveis</h3>
                <div style={styles.list.container}>
                  {permissions.map(permission => (
                    <div key={permission.id} style={styles.list.item}>
                      <h4 style={styles.list.title}>{permission.name}</h4>
                      <p style={styles.list.desc}>Recurso: {permission.resource}, Ação: {permission.action}</p>
                      <p style={styles.list.desc}>{permission.description}</p>
                    </div>
                  ))}
                </div>

                <h3>Nova Permissão</h3>
                <form onSubmit={handleCreatePermission} style={styles.form.container}>
                  <div style={styles.form.group}>
                    <label style={styles.form.label}>Recurso</label>
                    <input 
                      type="text" 
                      style={styles.form.input} 
                      value={newPermission.resource} 
                      onChange={e => setNewPermission({...newPermission, resource: e.target.value})}
                      required
                    />
                  </div>
                  <div style={styles.form.group}>
                    <label style={styles.form.label}>Ação</label>
                    <input 
                      type="text" 
                      style={styles.form.input} 
                      value={newPermission.action} 
                      onChange={e => setNewPermission({...newPermission, action: e.target.value})}
                      required
                    />
                  </div>
                  <div style={styles.form.group}>
                    <label style={styles.form.label}>Descrição</label>
                    <textarea 
                      style={styles.form.textarea} 
                      value={newPermission.description} 
                      onChange={e => setNewPermission({...newPermission, description: e.target.value})}
                      required
                    />
                  </div>
                  <button type="submit" style={styles.button.primary}>Criar Permissão</button>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Conteúdo da aba Usuários */}
        {activeTab === 'users' && (
          <div style={styles.tabs.content}>
            <div style={styles.flexRow}>
              <div style={styles.col40}>
                <h3>Usuários</h3>
                <div style={{ ...styles.list.container, maxHeight: '500px', overflowY: 'auto' }}>
                  {users.map(user => (
                    <div 
                      key={user.id} 
                      style={{
                        ...styles.list.item,
                        backgroundColor: selectedUser?.id === user.id ? '#e9f5ff' : 'white',
                        cursor: 'pointer'
                      }}
                      onClick={() => setSelectedUser(user)}
                    >
                      <h4 style={styles.list.title}>{user.nome || user.email}</h4>
                      <p style={styles.list.desc}>{user.email}</p>
                      {user.isOwnerOrAdmin && (
                        <span style={styles.badge.warning}>Admin Legacy</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              
              <div style={styles.col60}>
                {selectedUser && (
                  <div>
                    <h3>Roles do Usuário: {selectedUser.nome || selectedUser.email}</h3>
                    
                    <div style={styles.list.container}>
                      {userRoles.map(userRole => (
                        <div key={userRole.id} style={styles.list.item}>
                          <div style={styles.flexBetween}>
                            <div>
                              <h4 style={styles.list.title}>{userRole.roleName}</h4>
                              <p style={styles.list.desc}>
                                Contexto: {userRole.context.type}
                                {userRole.context.resourceId && ` (${userRole.context.resourceId})`}
                              </p>
                              <span style={getBadgeStyle(userRole.validationStatus)}>
                                {userRole.validationStatus}
                              </span>
                            </div>
                            <div>
                              <button 
                                style={{ ...styles.button.sm, ...styles.button.danger }}
                                onClick={() => handleRemoveRoleFromUser(userRole.id)}
                              >
                                Remover
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <h3>Atribuir Nova Role</h3>
                    <form onSubmit={handleAssignRoleToUser} style={styles.form.container}>
                      <div style={styles.form.group}>
                        <label style={styles.form.label}>Role</label>
                        <select 
                          style={styles.form.select} 
                          value={newUserRole.roleId} 
                          onChange={e => setNewUserRole({...newUserRole, roleId: e.target.value})}
                          required
                        >
                          <option value="">Selecione uma role</option>
                          {roles.map(role => (
                            <option key={role.id} value={role.id}>{role.name}</option>
                          ))}
                        </select>
                      </div>
                      <div style={styles.form.group}>
                        <label style={styles.form.label}>Tipo de Contexto</label>
                        <select 
                          style={styles.form.select} 
                          value={newUserRole.context.type} 
                          onChange={e => setNewUserRole({
                            ...newUserRole, 
                            context: {...newUserRole.context, type: e.target.value}
                          })}
                        >
                          <option value="global">Global</option>
                          <option value="caixinha">Caixinha</option>
                          <option value="marketplace">Marketplace</option>
                        </select>
                      </div>
                      {newUserRole.context.type !== 'global' && (
                        <div style={styles.form.group}>
                          <label style={styles.form.label}>ID do Recurso</label>
                          <input 
                            type="text" 
                            style={styles.form.input} 
                            value={newUserRole.context.resourceId} 
                            onChange={e => setNewUserRole({
                              ...newUserRole, 
                              context: {...newUserRole.context, resourceId: e.target.value}
                            })}
                            required
                          />
                        </div>
                      )}
                      <div style={styles.form.group}>
                        <label style={styles.form.label}>Status de Validação</label>
                        <select 
                          style={styles.form.select} 
                          value={newUserRole.options.validationStatus} 
                          onChange={e => setNewUserRole({
                            ...newUserRole, 
                            options: {...newUserRole.options, validationStatus: e.target.value}
                          })}
                        >
                          <option value="pending">Pendente</option>
                          <option value="validated">Validado</option>
                          <option value="rejected">Rejeitado</option>
                        </select>
                      </div>
                      <button type="submit" style={styles.button.primary}>Atribuir Role</button>
                    </form>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Função auxiliar para definir o estilo do badge baseado no status de validação
function getBadgeStyle(status) {
  if (status === 'validated') return styles.badge.success;
  if (status === 'rejected') return styles.badge.danger;
  return styles.badge.warning;
}

// Estilos
const styles = {
  flexRow: {
    display: 'flex',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: '20px'
  },
  flexBetween: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  col40: {
    flex: '0 0 40%'
  },
  col50: {
    flex: '0 0 48%'
  },
  col60: {
    flex: '0 0 55%'
  },
  alert: {
    base: {
      padding: '12px 16px',
      margin: '10px 0',
      borderRadius: '4px',
      fontSize: '14px',
    },
    info: {
      padding: '12px 16px',
      margin: '10px 0',
      borderRadius: '4px',
      fontSize: '14px',
      backgroundColor: '#cce5ff',
      color: '#004085',
      border: '1px solid #b8daff',
    },
    success: {
      padding: '12px 16px',
      margin: '10px 0',
      borderRadius: '4px',
      fontSize: '14px',
      backgroundColor: '#d4edda',
      color: '#155724',
      border: '1px solid #c3e6cb',
    },
    danger: {
      padding: '12px 16px',
      margin: '10px 0',
      borderRadius: '4px',
      fontSize: '14px',
      backgroundColor: '#f8d7da',
      color: '#721c24',
      border: '1px solid #f5c6cb',
    },
    warning: {
      padding: '12px 16px',
      margin: '10px 0',
      borderRadius: '4px',
      fontSize: '14px',
      backgroundColor: '#fff3cd',
      color: '#856404',
      border: '1px solid #ffeeba',
    }
  },
  button: {
    base: {
      display: 'inline-block',
      fontWeight: 400,
      textAlign: 'center',
      verticalAlign: 'middle',
      cursor: 'pointer',
      padding: '6px 12px',
      borderRadius: '4px',
      border: '1px solid transparent',
      fontSize: '14px',
    },
    primary: {
      display: 'inline-block',
      fontWeight: 400,
      textAlign: 'center',
      verticalAlign: 'middle',
      cursor: 'pointer',
      padding: '6px 12px',
      borderRadius: '4px',
      border: '1px solid transparent',
      fontSize: '14px',
      backgroundColor: '#007bff',
      color: 'white',
      borderColor: '#007bff',
    },
    secondary: {
      display: 'inline-block',
      fontWeight: 400,
      textAlign: 'center',
      verticalAlign: 'middle',
      cursor: 'pointer',
      padding: '6px 12px',
      borderRadius: '4px',
      border: '1px solid transparent',
      fontSize: '14px',
      backgroundColor: '#6c757d',
      color: 'white',
      borderColor: '#6c757d',
    },
    danger: {
      display: 'inline-block',
      fontWeight: 400,
      textAlign: 'center',
      verticalAlign: 'middle',
      cursor: 'pointer',
      padding: '6px 12px',
      borderRadius: '4px',
      border: '1px solid transparent',
      fontSize: '14px',
      backgroundColor: '#dc3545',
      color: 'white',
      borderColor: '#dc3545',
    },
    sm: {
      padding: '4px 8px',
      fontSize: '12px',
    }
  },
  tabs: {
    container: {
      border: '1px solid #dee2e6',
      borderRadius: '4px',
      overflow: 'hidden',
    },
    header: {
      display: 'flex',
      borderBottom: '1px solid #dee2e6',
      backgroundColor: '#f8f9fa',
    },
    active: {
      padding: '10px 15px',
      backgroundColor: 'white',
      border: 'none',
      borderBottom: '2px solid #007bff',
      fontWeight: 'bold',
      cursor: 'pointer',
    },
    inactive: {
      padding: '10px 15px',
      backgroundColor: 'transparent',
      border: 'none',
      cursor: 'pointer',
    },
    content: {
      padding: '16px',
    }
  },
  list: {
    container: {
      border: '1px solid #dee2e6',
      borderRadius: '4px',
      marginBottom: '20px',
    },
    item: {
      padding: '12px 16px',
      borderBottom: '1px solid #dee2e6',
    },
    title: {
      margin: '0 0 6px 0',
      fontSize: '16px',
    },
    desc: {
      margin: '0 0 4px 0',
      fontSize: '14px',
      color: '#6c757d',
    }
  },
  badge: {
    base: {
      display: 'inline-block',
      padding: '3px 6px',
      fontSize: '12px',
      fontWeight: 'bold',
      borderRadius: '4px',
      textTransform: 'uppercase',
    },
    info: {
      display: 'inline-block',
      padding: '3px 6px',
      fontSize: '12px',
      fontWeight: 'bold',
      borderRadius: '4px',
      textTransform: 'uppercase',
      color: 'white',
      backgroundColor: '#17a2b8',
    },
    success: {
      display: 'inline-block',
      padding: '3px 6px',
      fontSize: '12px',
      fontWeight: 'bold',
      borderRadius: '4px',
      textTransform: 'uppercase',
      color: 'white',
      backgroundColor: '#28a745',
    },
    warning: {
      display: 'inline-block',
      padding: '3px 6px',
      fontSize: '12px',
      fontWeight: 'bold',
      borderRadius: '4px',
      textTransform: 'uppercase',
      color: 'black',
      backgroundColor: '#ffc107',
    },
    danger: {
      display: 'inline-block',
      padding: '3px 6px',
      fontSize: '12px',
      fontWeight: 'bold',
      borderRadius: '4px',
      textTransform: 'uppercase',
      color: 'white',
      backgroundColor: '#dc3545',
    }
  },
  form: {
    container: {
      marginBottom: '20px',
    },
    group: {
      marginBottom: '15px',
    },
    label: {
      display: 'block',
      marginBottom: '5px',
      fontSize: '14px',
      fontWeight: 'bold',
    },
    input: {
      width: '100%',
      padding: '8px 12px',
      fontSize: '14px',
      lineHeight: 1.5,
      border: '1px solid #ced4da',
      borderRadius: '4px',
    },
    textarea: {
      width: '100%',
      padding: '8px 12px',
      fontSize: '14px',
      lineHeight: 1.5,
      border: '1px solid #ced4da',
      borderRadius: '4px',
      minHeight: '100px',
    },
    select: {
      width: '100%',
      padding: '8px 12px',
      fontSize: '14px',
      lineHeight: 1.5,
      border: '1px solid #ced4da',
      borderRadius: '4px',
      backgroundColor: 'white',
    },
    checkbox: {
      marginBottom: '15px',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
    }
  }
};

export default RBACPanel;