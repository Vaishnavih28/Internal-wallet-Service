import 'dotenv/config';
import express from 'express'
import walletRoutes from '../routes/walletRoutes.js'
import {loadSystemAccounts} from '../config/accountCache.js'


const PORT = process.env.PORT || 5000

const app = express();
app.use(express.json()); 

app.use('/api/wallet', walletRoutes);


loadSystemAccounts()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Wallet service running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to load system accounts:', err);
    process.exit(1);
  });
