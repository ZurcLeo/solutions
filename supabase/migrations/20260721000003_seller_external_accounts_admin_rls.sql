-- Permite que admins leiam seller_external_accounts (necessário para painel de testes)
CREATE POLICY admin_read_external_accounts ON seller_external_accounts
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = auth.uid()::text AND r.id = 'admin'
        )
    );

-- Corrige policy de ml_test_users (criada com coluna errada na migration anterior)
DROP POLICY IF EXISTS ml_test_users_admin_all ON ml_test_users;
CREATE POLICY ml_test_users_admin_all ON ml_test_users
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = auth.uid()::text AND r.id = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = auth.uid()::text AND r.id = 'admin'
        )
    );
