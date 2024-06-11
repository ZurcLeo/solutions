const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require('firebase-admin');

router.options('/create-payment-intent', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '3600');
    res.status(204).send('');
});

router.post('/create-payment-intent', async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');

    const { quantidade, valor, userId, description, recaptchaToken } = req.body;

    if (!quantidade || typeof quantidade !== 'number' || !valor || typeof valor !== 'number' || !userId || typeof userId !== 'string' || !description || typeof description !== 'string' || !recaptchaToken || typeof recaptchaToken !== 'string') {
        return res.status(400).send('Invalid request parameters');
    }

    const idToken = req.headers.authorization.split('Bearer ')[1];

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const email = decodedToken.email;

        // Lógica para verificação do reCAPTCHA
        // ...

        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(valor * 100),
            currency: 'BRL',
            description: description,
            metadata: { userId, quantidade },
            receipt_email: email,
        });

        // Registra a compra no Firestore
        const userRef = admin.firestore().collection('usuario').doc(userId);
        const comprasRef = userRef.collection('compras');
        await comprasRef.add({
            quantidade: quantidade,
            valorPago: valor,
            dataCompra: admin.firestore.FieldValue.serverTimestamp(),
            meioPagamento: 'stripe'
        });

        // Atualiza o saldo de ElosCoins do usuário
        await userRef.update({
            saldoElosCoins: admin.firestore.FieldValue.increment(quantidade)
        });

        return res.status(200).send({ clientSecret: paymentIntent.client_secret });
    } catch (error) {
        return res.status(500).send({ error: 'Erro ao criar a intenção de pagamento', details: error.message });
    }
});

module.exports = router;
