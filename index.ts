import { Client, Routes, Events, GatewayIntentBits, REST } from 'discord.js';

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
	TOKEN: string
	CLIENT_ID: string
	GUILD_ID: string
	BOT_PERMISSION_INT: number;
}

class Config {
	TOKEN: string
	CLIENT_ID: string
	GUILD_ID: string
	PERMISSION_INT: number;

	USER_DM_MSG_STRING_AUTH = '高専ゲーム鯖にようこそ。私は高専email認証botです。'
		+ '\n' + 'あなたがほんとに高専生がどうかを検証し、コミュニティの安定を保ために、学校ログインによる証明を実施しています。'
		+ "\n\n" + 'おっと。。不審に思われても仕方がないですが。簡単に説明すると、あなたの認証したメールアドレスとユーザーIDを結びつけて、サーバーに保存します。'
		+ '\n' + '安心してください、メールアドレスはハッシュ化されて保存されますし、取得した情報を第三者にお渡しするなんてことはありません。'
		+ '\n' + 'ハッシュ化について簡単に説明すると、「もしハッシュ化されたデータを一瞬で復元できるとしたら、1日で億万長者になれるレベル」で復元が不可能な形にして保存するセキュリティ処理です。'
		+ '\n' + '第三者どころか、bot管理者も復元が不可能です。'
		+ '\n\n' + 'こちらの認証用のリンクから認証を完了してください。'
		+ '\n' + 'スパムやbot対策のため、認証用のリンクは15分で無効になり、認証しないまま30分が経過すると自動でキックされます。'



	constructor() {
		this.TOKEN = process.env.BOT_TOKEN || '';
		this.CLIENT_ID = process.env.BOT_CLIENT_ID || '';
		this.GUILD_ID = process.env.BOT_GUILD_ID || '';
		this.PERMISSION_INT = parseInt(process.env.BOT_PERMISSION_INT || '0', 0);

		// 環境変数が設定されていない場合は強制終了する
		if (!this.TOKEN || !this.CLIENT_ID || !this.GUILD_ID || !this.PERMISSION_INT) {
			console.error('環境変数が設定されていません。');
			process.exit(1);
		}

	}

}

class UserCommunication extends Config {


	// ClientはConfigクラスで初期化されているので、UserCommunicationクラスではthis.clientを使ってDMを送信することができる
	async sendDM(client: Client, user_id: string): Promise<void> {
		const user = await client.users.fetch(user_id);
		await user.send(this.USER_DM_MSG_STRING_AUTH);
	}


}



async function main(): Promise<void> {


	const config: Config = new Config();

	const commands = [
		{
			name: 'auth-dm',
			description: 'DMを送信するコマンド',
		},
	];


	const rest = new REST({ version: '10' }).setToken(config.TOKEN);

	try {
		console.log('Started refreshing application (/) commands.');

		await rest.put(Routes.applicationCommands(config.CLIENT_ID), { body: commands });

		console.log('Successfully reloaded application (/) commands.');
	} catch (error) {
		console.error(error);
	}

	const client = new Client({ intents: [GatewayIntentBits.Guilds] });

	client.on(Events.ClientReady, readyClient => {
		console.log(`Logged in as ${readyClient.user.tag}!`);
	});

	client.on(Events.InteractionCreate, async interaction => {
		if (!interaction.isChatInputCommand()) return;


		if (interaction.commandName === 'auth-dm') {
			await interaction.reply('DMを送信しました！');
			await new UserCommunication().sendDM(client, interaction.user.id);

		}
	});

	client.login(config.TOKEN);
}

// __name__ == "__main__": block
if (require.main === module) {
	await main().catch(console.error);
}


