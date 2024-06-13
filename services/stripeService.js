const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require('firebase-admin');

const createPaymentIntent = async ({ quantidade, valor, userId, description, email }) => {
    try {
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(valor * 100), // Convertendo valor para centavos
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
            meioPagamento: 'stripe',
            nomeDoProduto: description
        });

        // Atualiza o saldo de ElosCoins do usuário
        await userRef.update({
            saldoElosCoins: admin.firestore.FieldValue.increment(quantidade)
        });

        return { clientSecret: paymentIntent.client_secret };
    } catch (error) {
        console.error('Erro ao criar a intenção de pagamento:', error);
        throw new Error('Erro ao criar a intenção de pagamento');
    }
};

module.exports = {
    createPaymentIntent,
    stripe,
};
