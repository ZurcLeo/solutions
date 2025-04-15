const admin = require('firebase-admin');
const { getFirestore } = require('../firebaseAdmin')
const { createHash } = require('crypto');


const db = getFirestore();

exports.calculateJA3 = async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Access-Control-Allow-Methods', 'GET, POST');
        res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.set('Access-Control-Max-Age', '3600');
        return res.status(204).send('');
    }

    try {
        const { version, cipherSuites, extensions, ellipticCurves, ellipticCurvePointFormats, userId } = req.body;

        const userRef = db.collection('usuario').doc(userId);
        const userDoc = await userRef.get();

        if (userDoc.exists && userDoc.data().ja3Hash) {
            return res.status(200).json({ ja3Hash: userDoc.data().ja3Hash });
        }

        const ja3String = `${version},${cipherSuites.join('-')},${extensions.join('-')},${ellipticCurves.join('-')},${ellipticCurvePointFormats.join('-')}`;
        const ja3Hash = createHash('md5').update(ja3String).digest('hex');

        await userRef.set({ ja3Hash }, { merge: true });

        res.set('Access-Control-Allow-Origin', '*');
        return res.status(200).json({ ja3Hash });
    } catch (error) {
        res.set('Access-Control-Allow-Origin', '*');
        return res.status(500).json({ error: 'Failed to calculate JA3 hash', details: error.message });
    }
};
