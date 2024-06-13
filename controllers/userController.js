const admin = require('firebase-admin');

exports.addUser = async (req, res) => {
    if (!req.auth) {
        return res.status(401).send('Apenas usuários autenticados podem adicionar usuários.');
    }

    try {
        const docRef = await admin.firestore().collection('usuario').add(req.body);
        res.status(200).send({ id: docRef.id });
    } catch (error) {
        res.status(500).send({ error: 'Erro ao adicionar usuário', details: error.message });
    }
};

exports.getUser = async (req, res) => {
    if (!req.auth) {
        return res.status(401).send('Apenas usuários autenticados podem buscar usuários.');
    }

    try {
        const doc = await admin.firestore().collection('usuario').doc(req.params.id).get();

        if (!doc.exists) {
            return res.status(404).send('Usuário não encontrado.');
        }

        res.status(200).send(doc.data());
    } catch (error) {
        res.status(500).send({ error: 'Erro ao buscar usuário', details: error.message });
    }
};

exports.updateUser = async (req, res) => {
    if (!req.auth || req.auth.uid !== req.body.id) {
        return res.status(403).send('Os usuários só podem atualizar seus próprios dados.');
    }

    try {
        const userRef = admin.firestore().collection('usuario').doc(req.body.id);

        await userRef.update(req.body.updateFields);
        res.status(200).send({ result: `Usuário com ID: ${req.body.id} atualizado com sucesso.` });
    } catch (error) {
        res.status(500).send({ error: 'Erro ao atualizar usuário', details: error.message });
    }
};
