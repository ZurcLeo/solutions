require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { RecaptchaEnterpriseServiceClient } = require('@google-cloud/recaptcha-enterprise');
const stripe = require('stripe')(process.env.STRIPE_PRIVATE_KEY);
const nodemailer = require('nodemailer');
const admin = require('firebase-admin');
const { getEmailTemplate } = require('./emailTemplate'); 

// Inicialize o Firebase Admin SDK
admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: process.env.FIREBASE_DATABASE_URL, 

});

const app = express();
app.use(cors({
    origin: 'https://eloscloud.com',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

app.use(express.json());
app.use(cors());
app.use(bodyParser.json());

// Configurar o transporte do nodemailer
const transporter = nodemailer.createTransport({
    host: 'smtp.office365.com',
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER, // Use variável de ambiente
        pass: process.env.SMTP_PASS  // Use variável de ambiente
    },
    tls: {
      ciphers: 'SSLv3'
    }
});

// Função para enviar email
async function sendEmail(to, subject, content) {
    const htmlContent = getEmailTemplate(subject, content);
    const mailOptions = {
        from: 'suporte@eloscloud.com.br',
        to: to,
        subject: subject,
        html: htmlContent,
        text: content.replace(/<[^>]*>?/gm, '') // Remove HTML tags for plain text version
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Email sent to ${to}`);
    } catch (error) {
        console.error('Error sending email:', error);
    }
}

const createAssessment = async ({
    projectID = "elossolucoescloud-1804e",
    recaptchaKey = "6LeOHeopAAAAANKidFB-GP_qqirmNYb9oF-87UZz",
    token,
    recaptchaAction = "purchase",
    userAgent,
    userIpAddress
}) => {
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
            recaptchaKey: process.env.RECAPTCHA_KEY,
            token: recaptchaToken,
            recaptchaAction: 'purchase',
            userAgent: req.get('User-Agent'),
            userIpAddress: req.ip,
        });

        if (recaptchaScore === null || recaptchaScore < 0.5) {
            return res.status(400).send('Falha na verificação do reCAPTCHA.');
        }

        try {
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

            // Envia um email de confirmação
            await sendEmail(email, 'Confirmação de Compra', `Sua compra de ${quantidade} ElosCoins foi realizada com sucesso!`);

            return res.status(200).send({ clientSecret: paymentIntent.client_secret });
        } catch (error) {
            return res.status(500).send({ error: 'Erro ao criar a intenção de pagamento', details: error.message });
        }
    } catch (error) {
        return res.status(403).send({ error: 'Unauthorized', details: error });
    }
});

app.post('/api/getTurnCredentials', async (req, res) => {
    const { userIdToken } = req.headers;
    
    if (!userIdToken) {
        return res.status(401).send('User must be authenticated');
    }

    try {
        const decodedToken = await admin.auth().verifyIdToken(userIdToken);
        
        const turnUser = process.env.TURN_USER;
        const turnPass = process.env.TURN_PASS;
        const turnUrls = process.env.TURN_URLS.split(',');

        const turnServer = {
            urls: turnUrls,
            username: turnUser,
            credential: turnPass
        };

        res.status(200).send({ turnServer });
    } catch (error) {
        res.status(403).send('Unauthorized');
    }
});


app.post('/api/generateInvite', async (req, res) => {
    const { email } = req.body;
    const { userIdToken } = req.headers;
    
    if (!userIdToken) {
        return res.status(401).send('User must be authenticated');
    }

    try {
        const decodedToken = await admin.auth().verifyIdToken(userIdToken);
        const senderId = decodedToken.uid;

        const userRef = admin.firestore().collection('usuario').doc(senderId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).send('User not found');
        }

        const userData = userDoc.data();
        const senderName = userData.nome || null;
        const senderPhotoURL = userData.fotoDoPerfil || null;

        if (!senderName || !senderPhotoURL) {
            return res.status(400).send({ 
                success: false, 
                redirectTo: `/PerfilPessoal/${senderId}`, 
                message: 'Por favor, preencha seu nome e foto de perfil para continuar.' 
            });
        }

        const inviteId = uuidv4();
        const createdAt = admin.firestore.FieldValue.serverTimestamp();

        const inviteData = {
            email,
            senderId,
            senderName,
            inviteId,
            createdAt,
            senderPhotoURL,
            status: 'pending'
        };

        await admin.firestore().collection('convites').doc(inviteId).set(inviteData, { merge: true });

        const content = `
            Olá! <br>
            Você recebeu um convite. <br><br>
            Clique no botão abaixo para aceitar o convite:
            <br><br>
            <a href="https://eloscloud.com.br/invite?inviteId=${inviteId}" style="background-color: #345C72; color: #ffffff; padding: 10px 20px; border-radius: 5px; text-decoration: none;">Aceitar Convite</a>
            <br><br>
            Obrigado, <br>
            Equipe ElosCloud
        `;

        await sendEmail(email, 'ElosCloud - Seu convite chegou!', content);

        const mailData = {
            to: [{ email: email }],
            subject: 'Seu convite chegou!',
            createdAt: createdAt,
            status: 'pending',
            data: {
                inviteId: inviteId,
                senderId: senderId,
                url: `https://eloscloud.com.br/invite?inviteId=${inviteId}`
            }
        };

        await admin.firestore().collection('mail').add(mailData);

        res.status(200).send({ success: true });
    } catch (error) {
        console.error('Erro ao gerar convite:', error);
        res.status(500).send('Erro ao gerar convite.');
    }
});



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
