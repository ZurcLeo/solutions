// middlewares/financialValidation.js
const validateFinancialOperation = async (req, res, next) => {
    try {
      const { amount, type, userId } = req.body;
  
      if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Invalid amount' });
      }
  
      if (type === 'debit') {
        const wallet = await Wallet.findByUserId(userId);
        if (!wallet || wallet.balance < amount) {
          return res.status(400).json({ error: 'Insufficient funds' });
        }
      }
  
      next();
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  