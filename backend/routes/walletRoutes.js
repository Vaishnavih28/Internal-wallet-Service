import express from 'express'
import { topUp, issueBonus,spend, getBalance,getHistory } from '../controller/walletController.js';


const router = express.Router();


router.post('/topup',topUp)
router.post('/bonus',issueBonus)
router.post('/spend', spend)     
router.get('/balance/:userId',getBalance)
router.get('/history/:userId', getHistory)
export default router;