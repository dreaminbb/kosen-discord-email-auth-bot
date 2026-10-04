# Repository Guide

## Commands

- Install the Bun-locked dependencies: `bun install`.
- Run the bot: `bun run index.ts`.
- Type-check without emitting files: `bunx tsc --noEmit`. There are no package scripts, automated tests, CI workflows, or installed lint tooling.

## Runtime

- `index.ts` is the Bun bot entrypoint; `apps-script/` is deployed separately as a Google Apps Script Web App.
- The bot requires `.env` values `BOT_TOKEN`, `BOT_CLIENT_ID`, `BOT_GUILD_ID`, `AUTH_WEB_APP_URL`, and `BOT_VERIFIED_ROLE_ID`; startup exits when any is absent. `.env` is gitignored: never commit it.
- Each startup registers the `auth-dm` and `auth-status` global application commands through Discord's REST API before logging in. Treat running the bot as a remote command-registration operation, not a local-only check.
- `auth-dm` DMs the Apps Script OAuth URL; `auth-status` checks the configured verified role in the configured guild.
- Apps Script secrets belong in Script Properties. Its `Schools` sheet only permits exact domains with `Status=verified`; do not add wildcard or unverified domains.

## Conventions

- Follow `eslint.config.js` when editing JavaScript or TypeScript: tabs for indentation, single quotes, semicolons, spaces inside object braces, and Stroustrup braces. The configuration is not currently backed by an installed ESLint package.
