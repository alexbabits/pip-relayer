import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve('../.env') });
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import input from "input";

const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH;

// Run once to get a session string for telegram. Save it to your .env
export async function getSessionString() {
    const sessionString = new StringSession("");
    const client = new TelegramClient(sessionString, apiId, apiHash, {connectionRetries: 5});

    // Start the client and authenticate
    await client.start({
        phoneNumber: async () => await input.text("Please enter your phone number: "),
        password: async () => await input.text("Please enter your password: "),
        phoneCode: async () => await input.text("Please enter the code you received: "),
        onError: (err) => console.log(err),
    });

    const savedSession = client.session.save();
    console.log("Session saved:", savedSession); // save this string to .env

    await client.disconnect();
}
getSessionString();