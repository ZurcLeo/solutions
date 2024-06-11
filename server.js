// server.js
const express = require('express');
const Joi = require('joi');

const app = express();
app.use(express.json());

// Define os schemas de validação
const registerSchema = Joi.object({
  username: Joi.string().min(3).required(),
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required()
    .pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#\$%\^&\*])(?=.{8,})'))
    .not().pattern(new RegExp(req.body.email.split('@')[0])),
  confirmPassword: Joi.string().valid(Joi.ref('password')).required()
});

const updateProfileSchema = Joi.object({
  name: Joi.string().min(3).required(),
  email: Joi.string().email().required(),
  address: Joi.string().required(),
  postalCode: Joi.string().pattern(new RegExp('^[0-9]{5}-[0-9]{3}$')).required(),
  phoneNumber: Joi.string().pattern(new RegExp('^[0-9]{10,11}$')).required(),
  creditCard: Joi.string().pattern(new RegExp('^[0-9]{16}$')).required(),
  securityCode: Joi.string().pattern(new RegExp('^[0-9]{3,4}$')).required()
});

// Rota de Registro
app.post('/register', (req, res) => {
  const { error } = registerSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ errors: error.details });
  }
  res.send('Registro bem-sucedido!');
});

// Rota de Atualização Cadastral
app.post('/update-profile', (req, res) => {
  const { error } = updateProfileSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ errors: error.details });
  }
  res.send('Atualização de perfil bem-sucedida!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
