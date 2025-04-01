import dotenv from 'dotenv';
import path from 'path';
import fs from "fs";
import { fileURLToPath } from 'url';
dotenv.config({ path: path.resolve('../.env') });

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/NewMessage.js";

import { ethers } from 'ethers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const withdrawRequestsPath = path.join(__dirname, 'withdrawRequests.json');

const apiId = Number(process.env.API_ID); // telegram apiID
const apiHash = process.env.API_HASH; // telegram apiHash
const botUserID = 8039769735;

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL, 369);
const wallet = new ethers.Wallet(process.env.PK, provider);
const pipABI = JSON.parse(fs.readFileSync(new URL("../abi/PipABI.json", import.meta.url), "utf-8"));

const poolInfo = {
    "0xd70be32c0443C0D6A615024D2A8fa28B8f98EF70": { value: 10000000000000000000000000n, token: "PLS", price: 0.00002}, // 1e18 @audit 10M PLS
    "0x78Ad604F0BCB61Ef683e13C3fA7D87F5dA3aa953": { value: 1000000000000000000000n, token: "PLS", price: 0.00002 }, // 1000e18
  
    "0xab54D57BDb3b9f76aFD3516b548331e9B57a7EA6": { value: 1000000000000000000n, token: "PLSX", price: 0.00002 }, // 1e18
    "0xf95ACA5A28523cC9181e8aB7E6601F8626a033B2": { value: 100000000000000000000n, token: "PLSX", price: 0.00002 }, // 100e18
  
    "0xfBB5Dcba8a198B3e8cc12d1AE73d1B92f0d3b355": { value: 100000000n, token: "EHEX", price: 0.002 }, // 1e8
  
    "0x8904B6B17D0664B30608bA2b2a024cdf2745CBB3": { value: 10000000000000000n, token: "INC", price: 1 }, // 1e16
};


async function calculateProfit(poolAddress, requestedGasInWei, feeBasisPoints, currentGwei) {

    // 0. Get pool information
    const pool = poolInfo[poolAddress];
    const denomination = pool.value;

    // 1. Cost
    const withdrawGasUnits = 500000n; // ~500k gas to call withdraw
    const txGasCost = currentGwei * withdrawGasUnits; // 5868615848007086 (5.8M GWEI) * 500000 = 2934 PLS (e18)
    const totalCostPLS = txGasCost + requestedGasInWei; // 2934 PLS + 42 PLS = 2976 PLS
    const PLSPriceUSD = 0.00002;
    const costUSD = Number(totalCostPLS) / (10 ** 18) * PLSPriceUSD; // (2976e18 / 1e18) * 0.00002 = $0.06

    // 2. Revenue
    const feeAmount = (denomination * feeBasisPoints) / 10000n; // 1000e18 * 69 / 10000 = 6.9e18

    let decimals;
    (pool.token === "PLS" || pool.token === "PLSX" || pool.token === "INC") ? decimals = 18 : decimals = 8;
    
    const feeUSD = Number(feeAmount) / (10 ** decimals) * pool.price; // (6.9e18 / 1e18) * 0.00002 = $0.000138

    // 3. Net Profit
    const profitUSD = feeUSD - costUSD;
    const profitable = profitUSD > 0;
    return { profitable, profitUSD, feeUSD, costUSD };
};


async function fulfillWithdrawRequests(sessionString, provider) {
    
    let withdrawRequests;
    let _minId = 1;

    // 1. Examine existing withdraw request data
    try {
        const fileContent = fs.readFileSync(withdrawRequestsPath, 'utf8');
        withdrawRequests = JSON.parse(fileContent);

        // Determine where to start gathering messages
        if (withdrawRequests.processedIds && Object.keys(withdrawRequests.processedIds).length > 0) {

            // Look at failed withdraws, if any exist start at the earliest one.
            const failedWithdrawIds = Object.entries(withdrawRequests.processedIds)
                .filter(([_, status]) => status === "withdraw_failed")
                .map(([id, _]) => parseInt(id));

            if (failedWithdrawIds.length > 0) {
                _minId = Math.min(...failedWithdrawIds);
                console.log(`Starting from smallest failed withdrawal ID: ${_minId}`);
            // Otherwise, we can start with the highest overall messageId that has been processed.
            } else {
                const messageIds = Object.keys(withdrawRequests.processedIds).map(id => parseInt(id));
                _minId = Math.max(...messageIds);
                console.log(`No failed withdrawals found. Starting at highest processed ID: ${_minId}`);
            }
        }
    // If JSON is empty, create it and start with default _minId of 1.
    } catch (error) {
        withdrawRequests = {
            processedIds: {}
        };
    }

    // 2. Fetch Messages
    const session = new StringSession(sessionString);
    const client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 3 });
    await client.connect();
    const channel = await client.getEntity("pulseinprivate");
    const messages = await client.getMessages(channel, {minId: _minId, limit: 10000});

    // Fetch current GWEI only once for historic messages, simplicity/reduced stress on RPC.
    // Might get stale if running this for the first time and there are alot of messages that can be fulfilled 
    let currentGasPrice = await provider.getFeeData();

    // 3. Process messages
    for (const message of messages) {
        if (!message.message) continue; // skip undefined/deleted messages
        if (Number(message.fromId?.userId?.value) !== botUserID) continue; // skip non-bot messages

        // parse Telegram message
        const msg = JSON.parse(message.message);
        
        // Instantiate specific pool for withdraw request
        const pool = new ethers.Contract(msg.poolAddress, pipABI, wallet);

        // format pubSignals struct object
        const pubSignals = {
            recipient: msg.recipient,
            gas: msg.gas,
            fee: msg.fee,
            nullifierHash: msg.nullifierHash,
            root: msg.root
        }
        
        // Check proof validity
        const proofValidAndUnused = await pool.checkProof(msg.proof, pubSignals);
        if (!proofValidAndUnused) {
            withdrawRequests.processedIds[message.id] = "invalid_proof";
            fs.writeFileSync(withdrawRequestsPath, JSON.stringify(withdrawRequests, null, 2));
            console.log(`Proof was invalid or nullifierHash already spent for messageID ${message.id}`);
            continue;
        }

        // Calculate profit of fulfilling withdraw request 
        const { profitable, profitUSD, feeUSD, costUSD } = await calculateProfit(
            msg.poolAddress, 
            BigInt(msg.gas), // Ex: 42000000000000000000 = 42 PLS
            BigInt(msg.fee), // Ex: 69 = 0.69%
            currentGasPrice.maxFeePerGas // Ex: 5868615848007086n wei = 5.87M GWEI
        );
        if (!profitable) {
            withdrawRequests.processedIds[message.id] = "unprofitable";
            fs.writeFileSync(withdrawRequestsPath, JSON.stringify(withdrawRequests, null, 2));
            console.log(`Proof was valid but recipient's fee offer was unprofitable for messageID ${message.id}`);
            continue;
        }

        // Optional: Don't fulfill absurd gas requests (1M+ PLS)
        if (BigInt(msg.gas) > 1000000000000000000000000n) {
            withdrawRequests.processedIds[message.id] = "gas_too_high";
            fs.writeFileSync(withdrawRequestsPath, JSON.stringify(withdrawRequests, null, 2));
            console.log(`Proof valid & profitable but gas request was too high for messageID ${message.id}`);
            continue;
        }
        console.log(proofValidAndUnused);
        console.log(profitable);
        // Execute the withdraw on behalf of recipient
        try {
            console.log("current gas cost (GWEI)", currentGasPrice.maxFeePerGas);
            const customGasPrice = (currentGasPrice.maxFeePerGas * 20n) / 10n; // 2x * max
            const tx = await pool.withdraw(msg.proof, pubSignals, { 
                value: msg.gas,
                maxFeePerGas: customGasPrice,
                maxPriorityFeePerGas: customGasPrice,
                gasLimit: 600000, // 600k gas limit (withdraw costs about 400-450k gas units, overestimating).
            });
            console.log(`Withdraw pending tx hash:`, tx.hash);
            const receipt = await tx.wait();
            console.log(`Withdraw tx succeeded for messageID ${message.id}. Finalized in block ${receipt.blockNumber}`);
            withdrawRequests.processedIds[message.id] = "fulfilled";
            fs.writeFileSync(withdrawRequestsPath, JSON.stringify(withdrawRequests, null, 2));
        } catch (error) {
            withdrawRequests.processedIds[message.id] = "withdraw_failed";
            fs.writeFileSync(withdrawRequestsPath, JSON.stringify(withdrawRequests, null, 2));
            console.log(`Withdaw tx failed for ${message.id}`, error.message);
            continue;
        } 
    }

    console.log(`All existing messages processed. Listening for new withdraw requests...`);

    // 4. Listen to new messages
    client.addEventHandler(async (event) => {
        const message = event.message;
        if (!message || !message.message) return;
        if (Number(message.fromId?.userId?.value) !== botUserID) return;

        console.log("-----------------------------------");
        console.log(`New message received - ID: ${message.id}`);

        try {
            // fresh gas price for each new live message
            currentGasPrice = await provider.getFeeData();

            const msg = JSON.parse(message.message);
            const pool = new ethers.Contract(msg.poolAddress, pipABI, wallet);

            const pubSignals = {
                recipient: msg.recipient,
                gas: msg.gas,
                fee: msg.fee,
                nullifierHash: msg.nullifierHash,
                root: msg.root
            };
            
            // Check proof validity
            const proofValidAndUnused = await pool.checkProof(msg.proof, pubSignals);
            if (!proofValidAndUnused) {
                withdrawRequests.processedIds[message.id] = "invalid_proof";
                fs.writeFileSync(withdrawRequestsPath, JSON.stringify(withdrawRequests, null, 2));
                console.log(`[LIVE] Proof was invalid or nullifierHash already spent for messageID ${message.id}`);
                return;
            } 

            // Calculate profit of fulfilling withdraw request 
            const { profitable, profitUSD, feeUSD, costUSD } = await calculateProfit(
                msg.poolAddress, 
                BigInt(msg.gas),
                BigInt(msg.fee),
                currentGasPrice.maxFeePerGas
            );
            if (!profitable) {
                withdrawRequests.processedIds[message.id] = "unprofitable";
                fs.writeFileSync(withdrawRequestsPath, JSON.stringify(withdrawRequests, null, 2));
                console.log(`[LIVE] Proof was valid but unprofitable for messageID ${message.id}`);
                return;
            }

            // Check for absurd gas requests
            if (BigInt(msg.gas) > 1000000000000000000000000n) {
                withdrawRequests.processedIds[message.id] = "gas_too_high";
                fs.writeFileSync(withdrawRequestsPath, JSON.stringify(withdrawRequests, null, 2));
                console.log(`[LIVE] Proof valid & profitable but gas request too high for messageID ${message.id}`);
                return;
            }

            // Execute the withdraw
            try {
                const customGasPrice = (currentGasPrice.maxFeePerGas * 20n) / 10n; // 2x max

                const tx = await pool.withdraw(msg.proof, pubSignals, { 
                    value: msg.gas,
                    maxFeePerGas: customGasPrice,
                    maxPriorityFeePerGas: customGasPrice,
                    gasLimit: 600000,
                });
                
                console.log(`[LIVE] Withdraw pending tx hash:`, tx.hash);
                const receipt = await tx.wait();
                console.log(`[LIVE] Withdraw succeeded for messageID ${message.id}. Block ${receipt.blockNumber}`);
                
                withdrawRequests.processedIds[message.id] = "fulfilled";
                fs.writeFileSync(withdrawRequestsPath, JSON.stringify(withdrawRequests, null, 2));
            } catch (error) {
                withdrawRequests.processedIds[message.id] = "withdraw_failed";
                fs.writeFileSync(withdrawRequestsPath, JSON.stringify(withdrawRequests, null, 2));
                console.log(`[LIVE] Withdraw failed for ${message.id}:`, error.message);
            }
        } catch (error) {
            console.log(`Something went wrong processing a new message.`);
        }
    }, new NewMessage({ chats: ["pulseinprivate"] }));

    console.log("Finished processing live withdraw request. Listening for new withdrawal requests...");
};
fulfillWithdrawRequests(process.env.SESSION_STRING, provider).catch(console.error);