// controllers/ja3Controller.js — Supabase-first (migrado de Firestore em 2026-05-19)
const { getSupabaseClient } = require('../config/supabase');
const { createHash } = require('crypto');

exports.calculateJA3 = async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(204).send('');

    try {
        const { version, cipherSuites, extensions, ellipticCurves, ellipticCurvePointFormats, userId } = req.body;
        const supabase = getSupabaseClient();

        if (supabase && userId) {
            const { data: user } = await supabase
                .from('users')
                .select('ja3_hash')
                .eq('id', userId)
                .maybeSingle();

            if (user?.ja3_hash) {
                return res.status(200).json({ ja3Hash: user.ja3_hash });
            }
        }

        const ja3String = `${version},${cipherSuites.join('-')},${extensions.join('-')},${ellipticCurves.join('-')},${ellipticCurvePointFormats.join('-')}`;
        const ja3Hash = createHash('md5').update(ja3String).digest('hex');

        if (supabase && userId) {
            await supabase.from('users').update({ ja3_hash: ja3Hash }).eq('id', userId);
        }

        return res.status(200).json({ ja3Hash });
    } catch (error) {
        return res.status(500).json({ error: 'Failed to calculate JA3 hash', details: error.message });
    }
};
