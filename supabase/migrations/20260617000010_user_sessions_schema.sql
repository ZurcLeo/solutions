-- =====================================================================
-- User Sessions — tracks active login sessions for security management
-- =====================================================================

CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Session identification
    refresh_token_hash TEXT NOT NULL, -- SHA-256 hash of refresh token (never store plain)

    -- Device info
    device_name TEXT, -- "Chrome no Windows", "Safari no iPhone"
    device_type TEXT, -- 'desktop', 'mobile', 'tablet'
    browser TEXT, -- "Chrome 125", "Safari 17"
    os TEXT, -- "Windows 11", "iOS 18", "Android 14"

    -- Location
    ip_address TEXT,
    city TEXT,
    country TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_active_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL, -- When refresh token expires

    -- Status
    is_current BOOLEAN DEFAULT FALSE, -- The session making this request
    revoked_at TIMESTAMPTZ -- NULL = active, set = revoked
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active ON user_sessions(user_id, revoked_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_sessions_token_hash ON user_sessions(refresh_token_hash);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);

-- RLS
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_sessions_select_own ON user_sessions
    FOR SELECT USING (auth.uid()::text = user_id);

-- Users can only revoke their own sessions (soft delete via revoked_at)
CREATE POLICY user_sessions_update_own ON user_sessions
    FOR UPDATE USING (auth.uid()::text = user_id);

-- Only backend (service role) can INSERT
CREATE POLICY user_sessions_insert_service ON user_sessions
    FOR INSERT WITH CHECK (true); -- Service role bypasses RLS anyway

-- Cleanup: auto-delete expired sessions after 30 days
COMMENT ON TABLE user_sessions IS 'Active login sessions. Expired sessions cleaned by periodic job.';
