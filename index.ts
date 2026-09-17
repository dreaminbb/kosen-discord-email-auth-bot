import { REST, Routes } from 'discord.js';


// commands:
// - `unregister` : 実行したユーザーのID、メールアドレスをsqliteから削除する
// - `status` : 実行したユーザーのIDはsqliteに登録されているかを確認する


// 新しいユーザーが入ってきた -> sqliteに情報があるかを確認 -> ない -> 高専のメール認証を開始する
// 	- [ ] 1. ユーザーの個人チャットにリンクを含むDMを送る
// 	- [ ] 2. ユーザーがリンクをクリックしてメール認証を完了する
// 	- [ ] 3. APIからのレスポンスを受け取り認証が成功したかを確認
// 	- [ ] 4. 成功した場合sqliteにユーザーのdiscordIDとメールアドレスを一緒に保存する
// 	- [ ] 5. 失敗した場合はユーザーにDMで失敗した旨を伝える
// 	- [ ] 6. 成功したユーザーには認証済み、高専生、年期のロールを付与する


// 監視
// もし認証していないユーザがいる場合は24時間以内に認証するようにDMで通知する -> 24時間以内に認証しなかった場合はサーバーからキックする


interface Config {
	discordToken: string
	discordClientId: string
	discordGuildId: string
	permissionInt: number;
}

class Config {
	discordToken: string;
	discordClientId: string;
	discordGuildId: string;
	permissionInt: number;

	constructor() {
		this.discordToken = process.env.BOT_TOKEN || '';
		this.discordClientId = process.env.BOT_CLIENT_ID || '';
		this.discordGuildId = process.env.BOT_GUILD_ID || '';
		this.permissionInt = parseInt(process.env.BOT_PERMISSION_INT || '0', 0);
		// console.debug(`Loaded environment variables: BOT_TOKEN=${this.discordToken}, BOT_CLIENT_ID=${this.discordClientId}, BOT_GUILD_ID=${this.discordGuildId}, BOT_PERMISSION_INT=${this.permissionInt}`);

		// 環境変数が設定されていない場合は強制終了する
		if (!this.discordToken || !this.discordClientId || !this.discordGuildId) {
			console.error('環境変数が設定されていません。');
			process.exit(1);
		}
	}

}

new Config();


// const commands = [
// 	{
// 		name: 'ping',
// 		description: 'Replies with Pong!',
// 	},
// ];
//
// const TOKEN = process.env.DISCORD_TOKEN;
// const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
// const rest = new REST({ version: '10' }).setToken(TOKEN);
//
// try {
// 	console.log('Started refreshing application (/) commands.');
//
// 	await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
//
// 	console.log('Successfully reloaded application (/) commands.');
// } catch (error) {
// 	console.error(error);
// }
