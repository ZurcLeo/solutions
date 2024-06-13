require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const admin = require('firebase-admin');
const { RecaptchaEnterpriseServiceClient } = require('@google-cloud/recaptcha-enterprise');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Inicializar o Firebase Admin SDK com credenciais de arquivo
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://elossolucoescloud-1804e-default-rtdb.firebaseio.com'
});

const app = express();

app.use(cors({
    origin: 'https://eloscloud.com',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

app.use(express.json());

// Função para verificar o reCAPTCHA
const createAssessment = async ({ projectID, recaptchaKey, token, recaptchaAction, userAgent, userIpAddress }) => {
    const client = new RecaptchaEnterpriseServiceClient();
    const projectPath = client.projectPath(projectID);

    const request = {
        assessment: {
            event: {
                token: token,
                siteKey: recaptchaKey,
                userAgent: userAgent,
                userIpAddress: userIpAddress,
                expectedAction: recaptchaAction,
            },
        },
        parent: projectPath,
    };

    const [response] = await client.createAssessment(request);

    if (!response.tokenProperties.valid) {
        console.log(`The CreateAssessment call failed because the token was: ${response.tokenProperties.invalidReason}`);
        return null;
    }

    if (response.tokenProperties.action === recaptchaAction) {
        console.log(`The reCAPTCHA score is: ${response.riskAnalysis.score}`);
        response.riskAnalysis.reasons.forEach((reason) => {
            console.log(reason);
        });
        return response.riskAnalysis.score;
    } else {
        console.log("The action attribute in your reCAPTCHA tag does not match the action you are expecting to score");
        return null;
    }
};

// Rota OPTIONS para lidar com requisições preflight
app.options('/api/create-payment-intent', (req, res) => {
    res.set('Access-Control-Allow-Origin', 'https://eloscloud.com');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '3600');
    res.status(204).send('');
});

app.post('/api/create-payment-intent', async (req, res) => {
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
            projectID: 'elossolucoescloud-1804e',
            recaptchaKey: '6LeOHeopAAAAANKidFB-GP_qqirmNYb9oF-87UZz',
            token: recaptchaToken,
            recaptchaAction: 'purchase',
            userAgent: req.get('User-Agent'),
            userIpAddress: req.ip,
        });

        if (recaptchaScore === null || recaptchaScore < 0.5) {
            return res.status(400).send('Falha na verificação do reCAPTCHA.');
        }

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
        console.error('Erro ao criar a intenção de pagamento:', error);
        return res.status(500).send({ error: 'Erro ao criar a intenção de pagamento', details: error.message });
    }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`Proxy server is running on port ${PORT}`);
});
