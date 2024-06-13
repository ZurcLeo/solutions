const admin = require('firebase-admin');
const { createAssessment } = require('../services/recaptchaService');
const { createPaymentIntent } = require('../services/stripeService');
const { sendEmail } = require('../utils/emailUtils');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.createPaymentIntent = async (req, res) => {
    res.set('Access-Control-Allow-Origin', 'https://eloscloud.com');

    const { quantidade, valor, userId, description, recaptchaToken } = req.body;

    if (!quantidade || typeof quantidade !== 'number' || !valor || typeof valor !== 'number' || !userId || typeof userId !== 'string' || !description || typeof description !== 'string' || !recaptchaToken || typeof recaptchaToken !== 'string') {
        return res.status(400).send('Invalid request parameters');
    }

    const idToken = req.headers.authorization.split('Bearer ')[1];

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const email = decodedToken.email;

        const recaptchaScore = await createAssessment({
            projectID: process.env.RECAPTCHA_PROJECT_ID,
            recaptchaKey: process.env.RECAPTCHA_KEY,
            token: recaptchaToken,
            recaptchaAction: 'purchase',
            userAgent: req.get('User-Agent'),
            userIpAddress: req.ip,
        });

        if (recaptchaScore === null || recaptchaScore < 0.5) {
            return res.status(400).send('Falha na verificação do reCAPTCHA.');
        }

        const paymentIntent = await createPaymentIntent({
            quantidade,
            valor,
            userId,
            description,
            email
        });

        return res.status(200).send(paymentIntent);
    } catch (error) {
        return res.status(500).send({ error: 'Erro ao criar a intenção de pagamento', details: error.message });
    }
};

exports.sessionStatus = async (req, res) => {
    const paymentIntentId = req.query.payment_intent;
    try {
        if (!paymentIntentId) {
            throw new Error('Payment Intent ID não fornecido');
        }

        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

        if (!paymentIntent) {
            throw new Error('Payment Intent não encontrado');
        }

        if (paymentIntent.status === 'succeeded') {
            // Envia o email de confirmação apenas se o pagamento foi concluído com sucesso
            const email = paymentIntent.receipt_email;
            const quantidade = paymentIntent.metadata.quantidade;
            await sendEmail(email, 'Confirmação de Compra', `Sua compra de ${quantidade} ElosCoins foi realizada com sucesso!`);
        }

        res.json({ status: paymentIntent.status, customer_email: paymentIntent.receipt_email });
    } catch (error) {
        console.error('Erro ao recuperar o estado da sessão:', error.message);
        res.status(500).send({ error: 'Erro ao recuperar o estado da sessão', details: error.message });
    }
};

exports.getPurchases = async (req, res) => {
    const idToken = req.headers.authorization.split('Bearer ')[1];

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const userId = decodedToken.uid;

        const purchasesSnapshot = await admin.firestore().collection('usuario').doc(userId).collection('compras').get();
        const purchases = purchasesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        res.status(200).json(purchases);
    } catch (error) {
        console.error('Erro ao buscar compras:', error);
        res.status(500).send({ error: 'Erro ao buscar compras', details: error.message });
    }
};
