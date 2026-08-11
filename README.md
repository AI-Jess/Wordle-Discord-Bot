# Wordle Reminder Bot

A Discord bot for your server that:
- Sends one randomized daily reminder (9am–9pm) pinging the whole channel with `@here` — no opt-in required, so it's no pressure for people who don't want to play
- Tracks results by reading Discord's official Wordle activity messages
- Posts a monthly and yearly "wrap-up" leaderboard (most puzzles completed, best average tries)

## 1. Create the Discord bot application

1. Go to https://discord.com/developers/applications and click **New Application**. Name it whatever you like.
2. In the left sidebar, click **Bot**.
3. Click **Reset Token** to generate a token, and copy it somewhere safe — you'll need it as `DISCORD_TOKEN`.
4. On the same Bot page, scroll to **Privileged Gateway Intents** and turn ON **Message Content Intent**. (Required for reading Wordle result messages.)
5. In the left sidebar, click **General Information** and copy the **Application ID** — this is your `DISCORD_CLIENT_ID`.
6. In the left sidebar, click **OAuth2 → URL Generator**:
   - Under **Scopes**, check `bot` and `applications.commands`.
   - Under **Bot Permissions**, check `Send Messages`, `Read Message History`, `View Channel`, and **`Manage Roles`** (needed so the bot can create the reminder role and add/remove it when people click the button).
   - Copy the generated URL at the bottom, paste it into your browser, and select your server to invite the bot.

## 2. Set up the project

1. Copy `.env.example` to `.env` and fill in your token and client ID:
   ```
   DISCORD_TOKEN=your_bot_token_here
   DISCORD_CLIENT_ID=your_application_id_here
   ```
2. Install dependencies:
   ```
   npm install
   ```
3. Run it locally to test:
   ```
   npm start
   ```
   You should see `Logged in as YourBot#1234` in the console.

## 3. Deploy for free, 24/7 — Oracle Cloud Always Free tier

Oracle Cloud's Always Free tier gives you a small VM that never sleeps and never expires — no trial period, no credit card charge as long as you stay within the free shape. It takes a bit more setup than a one-click host, but it's the most reliable genuinely-free option for something that needs to run permanently.

1. Sign up at https://www.oracle.com/cloud/free/ (a card is required for identity verification, but the Always Free resources are never billed).
2. Once in the console, go to **Compute → Instances → Create Instance**.
3. Name it, and under **Image and Shape**, pick **Ubuntu** as the image and choose an **Always Free eligible shape** (an "Ampere A1" ARM shape or a "Micro" AMD shape — both are marked "Always Free" in the picker).
4. Under **Networking**, keep the defaults (a public IP is fine — the bot only makes outbound connections, so you don't need to open any inbound ports).
5. Under **Add SSH keys**, either generate a new key pair and download the private key, or paste in a public key of your own.
6. Click **Create**. Once it's running, note its public IP address.
7. SSH into it from your computer:
   ```
   ssh -i /path/to/your-key.pem ubuntu@YOUR_INSTANCE_IP
   ```
8. Install Node.js and git:
   ```
   sudo apt update && sudo apt install -y nodejs npm git
   ```
9. Get your bot's code onto the VM. Easiest way: push this project to a private GitHub repo, then on the VM:
   ```
   git clone https://github.com/yourname/wordle-bot.git
   cd wordle-bot
   npm install
   ```
10. Create the `.env` file directly on the VM (don't commit it to GitHub):
    ```
    nano .env
    ```
    Paste in your `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`, then save (Ctrl+O, Enter, Ctrl+X).
11. Install `pm2` to keep the bot running in the background and auto-restart it if it crashes or the VM reboots:
    ```
    sudo npm install -g pm2
    pm2 start index.js --name wordle-bot
    pm2 save
    pm2 startup
    ```
    (`pm2 startup` will print one more command to run — copy/paste and run that too, it registers pm2 to launch on boot.)
12. Check it's alive:
    ```
    pm2 logs wordle-bot
    ```
    Look for `Logged in as YourBot#1234`.

From here, to make changes: edit the code (on the VM, or push new commits and `git pull`), then `pm2 restart wordle-bot`.

## 4. Set up in your server

In the channel where your group plays Wordle, run:
```
/set-channel
```
Then run:
```
/setup-reminder-button
```
This creates a "Wordle" role (if it doesn't already exist) and posts a message with a button — this only happens once, when you run the command, it's separate from the daily reminders. Pin that message at the top of the channel so people can find it anytime. Anyone who wants the daily reminder clicks the button once to opt in — clicking again removes them. The reminder will ping that role once a day at a random time between 9am and 9pm (server time zone; see Notes below to change it).

One Discord quirk to know: the bot's own role needs to sit **above** the "Wordle" role in your server's role list (Server Settings → Roles) for it to be able to add/remove that role from people. If the button doesn't seem to work, that's the first thing to check.

## 5. Calibrate the auto-detection (important)

Discord doesn't publish the exact format of the Wordle activity's result messages, so `parser.js` is a best-effort starting point. Once your group has posted at least one day's results:

1. Run `/debug-last-wordle-message` in the tracked channel.
2. Check the bot's logs (`pm2 logs wordle-bot` on the VM) for the block between `--- RAW WORDLE-LIKE MESSAGE ---` and `--- END ---`.
3. Send that JSON back and I'll tighten up `parseWordleMessage()` in `parser.js` to match it exactly.

## 6. Fallback: manual logging

If auto-detection ever misses someone, log a result by hand:
```
/log-result name:Jess tries:4
```
(Use `tries:7` to represent a failed/X-out-of-6 attempt.)

## Notes

- Reminder window and time zone: edit `WINDOW_START_HOUR` / `WINDOW_END_HOUR` in `reminder.js`. The bot uses the server's system time zone — set a `TZ` environment variable (e.g. `TZ=America/Chicago`) in your `.env` if the VM's default time zone doesn't match yours.
- Monthly wrap posts automatically on the 1st of each month; yearly wrap posts automatically on Jan 1st. Both can also be triggered manually with `/wrap-month` and `/wrap-year`.
- All data is stored in `data/store.json` right on the VM's disk, so it persists across restarts as long as you don't delete the folder.
