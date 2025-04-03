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
    "0x487ab5De5e8bEC9cb593fA7B587503c52E451520": { value: 10000000000000000000000000n, token: "PLS", price: 0.00002}, // 10Me18 
    "0x83953319D11F17dE24C89Cbfb580B69Ef3c3B9A6": { value: 100000000000000000000000000n, token: "PLS", price: 0.00002}, // 100Me18 
    "0x9Cf56Cb9198321A4bdE35bd11973E32Ef1A047b4": { value: 300000000000000000000000000n, token: "PLS", price: 0.00002}, // 300Me18 
    "0xee1f3875Ec9A8d90bd47351E8509dbb4550BF4A7": { value: 1000000000000000000000000000n, token: "PLS", price: 0.00002}, // 1Be18 

    "0x16ABdB6c69726a7a570265F0975ecb7f66Fed624": { value: 10000000000000000000000000n, token: "PLSX", price: 0.00002}, // 10Me18 
    "0xbFeFe59a8B0d52892F93841A97Bd90B3d39Af20C": { value: 100000000000000000000000000n, token: "PLSX", price: 0.00002}, // 100Me18 
    "0x691F31938EE3A1d7Bad242517d42Da4d16226b5f": { value: 300000000000000000000000000n, token: "PLSX", price: 0.00002}, // 300Me18 
    "0x1aCb121E71E5468815147B3B2bdaCB2377052679": { value: 1000000000000000000000000000n, token: "PLSX", price: 0.00002}, // 1Be18 

    "0x017F40249a19bC39DB8FeaaD0164F724b52afaf5": { value: 5000000000000n, token: "PHEX", price: 0.005 }, // 50Ke8
    "0xF67Bc6353D2bCfc73E3254e4F30D02Ad27450c86": { value: 50000000000000n, token: "PHEX", price: 0.005 }, // 500Ke8
    "0x1d8ce3380d189f2932c7Ae9C58489D34cc0335CD": { value: 150000000000000n, token: "PHEX", price: 0.005 }, // 1.5Me8
    "0x8A4bdFEd5B5C63111Bf8432787199bCE71F47210": { value: 500000000000000n, token: "PHEX", price: 0.005 }, // 5Me8

    "0x8f4544b02D7e6DB7D625fAfa84C9211593A4B23f": { value: 15000000000000n, token: "EHEX", price: 0.005 }, // 150Ke8
    "0xE177b96c8e414F2C3e2048D7E0f1073544BA5555": { value: 150000000000000n, token: "EHEX", price: 0.005 }, // 1.5Me8
    "0x77117957aD26F9b2D64bE93bF5b6d3d5D6fA0798": { value: 500000000000000n, token: "EHEX", price: 0.005 }, // 5Me8
    "0xaf8FcD4de7dBA23ccEe64070D8874eAc4410E102": { value: 1500000000000000n, token: "EHEX", price: 0.005 }, // 15Me8

    "0x1BA7bF077B0F8b6317CBB9264518E82A936FCce8": { value: 200000000000000000000n, token: "INC", price: 1 }, // 200e18
    "0x12542E68E46012D3586B4561F2cc9dB3306fAE08": { value: 2000000000000000000000n, token: "INC", price: 1 }, // 2Ke18
    "0x0468277a1DeA8Cd2e376D38F639978f610a754fe": { value: 6000000000000000000000n, token: "INC", price: 1 }, // 6Ke18
    "0xeE261152ac9E0b1b5fcFa4777337B5E068FeD49b": { value: 20000000000000000000000n, token: "INC", price: 1 }, // 20Ke18
};


async function calculateProfit(poolAddress, requestedGasInWei, feeBasisPoints, currentGwei) {

    // 0. Get pool information
    const pool = poolInfo[poolAddress];
    const denomination = pool.value;

    // 1. Cost
    const withdrawGasUnits = 500000n; // ~500k gas to call withdraw (overestimate)
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
            // (Since all stored requests at this point will be one of: {fulfilled, invalid_proof, gas_too_high, unprofitable}})
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
        let currentGasPrice = await provider.getFeeData();
        console.log(`Gas price for messageID ${message.id} is ${currentGasPrice.maxFeePerGas}`);
        const { profitable, profitUSD, feeUSD, costUSD } = await calculateProfit(
            msg.poolAddress, 
            BigInt(msg.gas), // Ex: 42000000000000000000 = 42 PLS
            BigInt(msg.fee), // Ex: 69 = 0.69%
            currentGasPrice.maxFeePerGas // Ex: 5868615848007086n wei = 5.87M GWEI
        );
        console.log(`Fee earned (USD): ${feeUSD}`);
        console.log(`Cost to fulfill (USD): ${costUSD}`);
        console.log(`Net Profit (USD): ${profitUSD}`);
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

        // Execute the withdraw on behalf of recipient
        try {
            console.log("current gas cost (GWEI)", currentGasPrice.maxFeePerGas);
            const customGasPrice = (currentGasPrice.maxFeePerGas * 20n) / 10n; // 2x * max
            const tx = await pool.withdraw(msg.proof, pubSignals, { 
                value: msg.gas,
                maxFeePerGas: customGasPrice,
                maxPriorityFeePerGas: customGasPrice,
                gasLimit: 500000, // 500k gas limit (withdraw costs about 400-450k gas units, overestimating).
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
            let currentGasPrice = await provider.getFeeData();
            const { profitable, profitUSD, feeUSD, costUSD } = await calculateProfit(
                msg.poolAddress, 
                BigInt(msg.gas),
                BigInt(msg.fee),
                currentGasPrice.maxFeePerGas
            );
            console.log(`Fee earned (USD): ${feeUSD}`);
            console.log(`Cost to fulfill (USD): ${costUSD}`);
            console.log(`Net Profit (USD): ${profitUSD}`);
            if (!profitable) {
                withdrawRequests.processedIds[message.id] = "unprofitable";
                fs.writeFileSync(withdrawRequestsPath, JSON.stringify(withdrawRequests, null, 2));
                console.log(`[LIVE] Proof was valid but unprofitable for messageID ${message.id}`);
                return;
            }

            // Optional: Don't fulfill absurd gas requests (1M+ PLS)
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
                    gasLimit: 500000,
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