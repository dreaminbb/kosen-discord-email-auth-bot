import { Client, Events, GatewayIntentBits, REST, Routes } from 'discord.js';

class Config {
	token: string;
	clientId: string;
	guildId: string;
	authWebAppUrl: string;
	verifiedRoleId: string;

	constructor() {
		this.token = requiredEnvironment('BOT_TOKEN');
		this.clientId = requiredEnvironment('BOT_CLIENT_ID');
		this.guildId = requiredEnvironment('BOT_GUILD_ID');
		this.authWebAppUrl = requiredEnvironment('AUTH_WEB_APP_URL');
		this.verifiedRoleId = requiredEnvironment('BOT_VERIFIED_ROLE_ID');
	}

	getAuthorizationUrl(): string {
		const url = new URL(this.authWebAppUrl);
		url.searchParams.set('action', 'begin');
		return url.toString();
	}
}

function requiredEnvironment(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required environment variable: ${name}`);
	return value;
}

async function sendAuthorizationDm(client: Client, userId: string, authorizationUrl: string): Promise<void> {
	const user = await client.users.fetch(userId);
	await user.send([
		'高専ゲーム鯖へようこそ。学校メール認証を開始します。',
		'',
		'以下のリンクを開き、Discord の認可を完了してください。その後、表示されたワンタイムコードを件名にして学校メールから送信します。',
		authorizationUrl,
		'',
		'認証コードは10分で失効します。メール本文、氏名、平文メールアドレスは保存しません。',
	].join('\n'));
}

async function isVerified(client: Client, guildId: string, userId: string, verifiedRoleId: string): Promise<boolean> {
	const guild = await client.guilds.fetch(guildId);
	const member = await guild.members.fetch(userId);
	return member.roles.cache.has(verifiedRoleId);
}

async function main(): Promise<void> {
	const config = new Config();
	const commands = [
		{
			name: 'auth-dm',
			description: '学校メール認証用のリンクをDMで受け取る',
		},
		{
			name: 'auth-status',
			description: '学校メール認証の状態を確認する',
		},
	];
	const rest = new REST({ version: '10' }).setToken(config.token);

	console.log('Registering application commands.');
	await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
	console.log('Application commands registered.');

	const client = new Client({ intents: [GatewayIntentBits.Guilds] });
	client.once(Events.ClientReady, readyClient => {
		console.log(`Logged in as ${readyClient.user.tag}.`);
	});

	client.on(Events.InteractionCreate, async interaction => {
		if (!interaction.isChatInputCommand()) return;

		try {
			if (interaction.commandName === 'auth-dm') {
				await interaction.deferReply({ ephemeral: true });
				await sendAuthorizationDm(client, interaction.user.id, config.getAuthorizationUrl());
				await interaction.editReply('認証用リンクをDMで送信しました。DMを受け取れない場合は、サーバーからのDMを許可してください。');
				return;
			}

			if (interaction.commandName === 'auth-status') {
				if (interaction.guildId !== config.guildId) {
					await interaction.reply({ content: 'このコマンドは認証対象のサーバー内で実行してください。', ephemeral: true });
					return;
				}
				const verified = await isVerified(client, config.guildId, interaction.user.id, config.verifiedRoleId);
				await interaction.reply({
					content: verified ? '学校メール認証は完了しています。' : '学校メール認証は完了していません。`/auth-dm` で認証を開始してください。',
					ephemeral: true,
				});
			}
		} catch (error) {
			console.error('Interaction failed:', error);
			const message = '処理に失敗しました。DMの受信設定と認証状態を確認して、もう一度お試しください。';
			if (interaction.deferred || interaction.replied) {
				await interaction.editReply(message);
			} else {
				await interaction.reply({ content: message, ephemeral: true });
			}
		}
	});

	await client.login(config.token);
}


if (import.meta.main) await main().catch(error => {
  console.error(error);
  process.exit(1);
});
