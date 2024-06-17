const admin = require('firebase-admin');
const { createHash } = require('crypto');

exports.calculateJA3Hash = async (data) => {
    const { version, cipherSuites, extensions, ellipticCurves, ellipticCurvePointFormats, userId } = data;

    const userRef = admin.firestore().collection('usuario').doc(userId);
    const userDoc = await userRef.get();

    if (userDoc.exists && userDoc.data().ja3Hash) {
        return { ja3Hash: userDoc.data().ja3Hash };
    }

    const ja3String = `${version},${cipherSuites.join('-')},${extensions.join('-')},${ellipticCurves.join('-')},${ellipticCurvePointFormats.join('-')}`;
    const ja3Hash = createHash('md5').update(ja3String).digest('hex');

    await userRef.set({ ja3Hash }, { merge: true });

    return { ja3Hash };
};
