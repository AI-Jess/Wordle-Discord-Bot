# Wordle Discord Bot

Runs entirely on GitHub Actions. No computer has to stay on.

## What it does

Every hour from 8 AM to 10 PM Central, one run of the **Wordle bot** workflow:

1. **Logs scores** from the daily summary that Discord's Wordle activity posts.
2. **Sends the reminder** at a random hour between 9 AM and 8 PM. It goes out once a day.
3. **Posts any recap that's due**, at 7 PM Central:
   - **Wordle Wrapped** every Monday, covering the previous Monday to Sunday. It includes the leaderboard, best guess, who choked (X/6), most improved, active streaks, and the toughest day.
   - **Monthly wrap** on the 1st.
   - **Yearly wrap** on Jan 1. After it posts, the previous year's results are cleared, except the last two weeks of December.

A fail (X) counts as 7 guesses in every average.

## Running it yourself

Use **Actions → Wordle bot → Run workflow**. This also works in the GitHub phone app. It replaces the old slash commands.

| Action | Does |
|---|---|
| `wrap-week`, `wrap-month`, `wrap-year` | Recap of the current period so far, or the last full one (`period`). It's a preview in the run summary unless **post** is checked. |
| `reminder` | Sends the reminder now. |
| `log-result` | Manually logs a score, with `name`, `tries` (7 = X) and `date`. |
| `backfill` | Re-reads the channel since Jan 1 and logs every summary it finds. |

## Where history lives

History is saved as `store.json` on the repo's **`data`** branch. Each run commits only if something changed. To restore an old file, replace `store.json` on that branch.

## Setup

These go in **Settings → Secrets and variables → Actions**:

- Secret `DISCORD_TOKEN`: the bot's token.
- Variable `DISCORD_CHANNEL_ID`: the Wordle channel.
- Variable `DISCORD_ROLE_ID` (optional): the role to ping.

The bot needs the **Message Content** intent turned on in the Discord Developer Portal. It already is if the old version worked.
