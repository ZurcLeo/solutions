const admin = require('firebase-admin');
const { logger } = require('../logger');
const { createAssessment } = require('../services/recaptchaService');
const { createPaymentIntent } = require('../services/stripeService');
const { validatePaymentRequest } = require('../validators/paymentValidator');
const { sendEmail } = require('../services/emailService');
const PaymentService = require('../services/paymentService');
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
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

        // Verificar se o pagamento foi concluído com sucesso antes de enviar o email
        if (paymentIntent.status === 'succeeded') {
            const decodedToken = await admin.auth().verifyIdToken(req.headers.authorization.split('Bearer ')[1]);
            const email = decodedToken.email;

            // Envia um email de confirmação
            await sendEmail(email, 'Confirmação de Compra', `Sua compra de ${paymentIntent.metadata.quantidade} ElosCoins foi realizada com sucesso!`);
        }

        res.json({ status: paymentIntent.status, customer_email: paymentIntent.receipt_email });
    } catch (error) {
        console.error('Erro ao recuperar o estado da sessão:', error);
        res.status(500).send('Erro ao recuperar o estado da sessão');
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

exports.getAllPurchases = async (req, res) => {
    try {
        const purchasesSnapshot = await admin.firestore().collectionGroup('compras').get();
        const purchases = purchasesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        res.status(200).json(purchases);
    } catch (error) {
        console.error('Erro ao buscar todas as compras:', error);
        res.status(500).send({ error: 'Erro ao buscar todas as compras', details: error.message });
    }
};

exports.createPixPayment = async (req, res) => {
    try {
        const { amount, description, email, identificationType, identificationNumber } = req.body;
        const userId = req.user?.uid;

        if (!amount || !description || !email || !identificationType || !identificationNumber) {
            return res.status(400).json({ error: 'Missing required fields' });
          }
  
      logger.info('Received PIX payment request', {
        controller: 'PaymentController',
        method: 'createPixPayment',
        userId,
        amount,
        description
      });
  
      const validateCPF = (identificationNumber) => {
        identificationNumber = identificationNumber.replace(/\D/g, ''); // Remove pontos e traços
        if (identificationNumber.length !== 11 || /^(\d)\1+$/.test(identificationNumber)) return false; // Formato inválido
      
        let sum = 0, rest;
        for (let i = 1; i <= 9; i++) sum += parseInt(identificationNumber.substring(i - 1, i)) * (11 - i);
        rest = (sum * 10) % 11;
        if (rest === 10 || rest === 11) rest = 0;
        if (rest !== parseInt(identificationNumber.substring(9, 10))) return false;
      
        sum = 0;
        for (let i = 1; i <= 10; i++) sum += parseInt(identificationNumber.substring(i - 1, i)) * (12 - i);
        rest = (sum * 10) % 11;
        if (rest === 10 || rest === 11) rest = 0;
        return rest === parseInt(identificationNumber.substring(10, 11));
      };

      // Validate request data
      const validationError = validatePaymentRequest(amount, description);
      if (validationError) {
        logger.warn('Invalid payment request', {
          controller: 'PaymentController',
          method: 'createPixPayment',
          error: validationError,
          userId
        });
        return res.status(400).json({ error: validationError });
      }
  
      // Create payment
      const paymentData = await PaymentService.createPixPayment(amount, description, {
        email,
        identificationType,
        identificationNumber: validateCPF,
      });
  
      logger.info('PIX payment created successfully', {
        controller: 'PaymentController',
        method: 'createPixPayment',
        paymentId: paymentData.id,
        userId
      });
  
      res.status(200).json(paymentData);
  
    } catch (error) {
      logger.error('Error processing PIX payment', {
        controller: 'PaymentController',
        method: 'createPixPayment',
        error: error.message,
        stack: error.stack
      });
  
      res.status(500).json({
        error: 'Failed to process payment',
        message: error.message
      });
    }
  };
  
  exports.checkPixPaymentStatus = async (req, res) => {
    try {
      const { paymentId } = req.params;
      const userId = req.user?.uid;
  
      if (!paymentId) {
        return res.status(400).json({ error: 'Payment ID is required' });
      }

      logger.info('Checking payment status', {
        controller: 'PaymentController',
        method: 'checkPaymentStatus',
        paymentId,
        userId
      });
  
      const status = await PaymentService.checkPaymentStatus(paymentId);
  
      res.status(200).json(status);
  
    } catch (error) {
      logger.error('Error checking payment status', {
        controller: 'PaymentController',
        method: 'checkPaymentStatus',
        error: error.message,
        stack: error.stack
      });
  
      res.status(500).json({
        error: 'Failed to check payment status',
        message: error.message
      });
    }
  };
  
  // Payment webhook to handle status updates from Mercado Pago
  exports.handleWebhook = async (req, res) => {
    try {
      const { data } = req.body;
  
      logger.info('Received payment webhook', {
        controller: 'PaymentController',
        method: 'handleWebhook',
        data
      });
  
      // Verify webhook signature
      if (!verifyWebhookSignature(req)) {
        logger.warn('Invalid webhook signature', {
          controller: 'PaymentController',
          method: 'handleWebhook'
        });
        return res.status(401).json({ error: 'Invalid signature' });
      }
  
      // Process payment update
      if (data.type === 'payment') {
        const paymentStatus = await PaymentService.checkPaymentStatus(data.id);
        
        // Emit event for real-time updates
        // eventEmitter.emit('paymentUpdate', { paymentId: data.id, status: paymentStatus });
      }
  
      res.status(200).send();
  
    } catch (error) {
      logger.error('Error processing webhook', {
        controller: 'PaymentController',
        method: 'handleWebhook',
        error: error.message,
        stack: error.stack
      });
  
      res.status(500).json({
        error: 'Failed to process webhook',
        message: error.message
      });
    }
  };