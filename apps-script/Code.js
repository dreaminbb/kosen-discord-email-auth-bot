const TOKEN_SHEET = 'VerificationTokens';
const VERIFICATION_SHEET = 'Verifications';
const SCHOOL_SHEET = 'Schools';
const TOKEN_TTL_MS = 10 * 60 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function doGet(event) {
	const action = event.parameter.action;
	if (action === 'begin') return beginDiscordOAuth();
	if (action === 'callback') return finishDiscordOAuth(event.parameter);
	return html('Invalid request.', 'Open this page from Discord to begin verification.');
}

function beginDiscordOAuth() {
	const properties = getProperties();
	const state = randomToken(32);
	properties.setProperty(statePropertyKey(state), JSON.stringify({ expiresAt: Date.now() + STATE_TTL_MS }));
	const query = toQueryString({
		client_id: requiredProperty('DISCORD_CLIENT_ID'),
		redirect_uri: requiredProperty('DISCORD_REDIRECT_URI'),
		response_type: 'code',
		scope: 'identify',
		state,
	});
	return HtmlService.createHtmlOutput(`<script>location.replace('https://discord.com/oauth2/authorize?${query}');</script>`);
}

function finishDiscordOAuth(parameters) {
	if (parameters.error) return html('Discord authorization was cancelled.', 'Return to Discord and start verification again.');
	if (!consumeState(parameters.state)) return html('This authorization link has expired.', 'Return to Discord and start verification again.');
	if (!parameters.code) return html('Discord did not return an authorization code.', 'Return to Discord and start verification again.');

	try {
		const accessToken = exchangeDiscordCode(parameters.code);
		const discordUser = discordRequest('https://discord.com/api/v10/users/@me', accessToken, 'Bearer');
		const token = createVerificationToken(discordUser.id);
		return html('Send your school email', [
			`Within 10 minutes, send an email from your school address to <strong>${escapeHtml(requiredProperty('VERIFICATION_INBOX'))}</strong>.`,
			`Use this exact subject: <code>[KOSEN-AUTH] ${token.code}</code>.`,
			'Only the email headers are checked. The body is not read or stored.',
		].join('<br><br>'));
	} catch (error) {
		console.error(error);
		return html('Authorization could not be completed.', 'Return to Discord and start verification again.');
	}
}

function pollVerificationMailbox() {
	const lock = LockService.getScriptLock();
	if (!lock.tryLock(1000)) return;
	try {
		const now = new Date();
		getActiveTokens().forEach(token => {
			if (new Date(token.expiresAt) <= now) {
				updateToken(token.row, { status: 'expired' });
				return;
			}
			const messages = Gmail.Users.Messages.list('me', {
				q: `in:anywhere subject:"[KOSEN-AUTH] ${token.code}" after:${gmailDate(new Date(token.createdAt))}`,
				maxResults: 10,
			}).messages || [];
			messages.some(message => inspectVerificationMessage(token, message.id));
		});
	} finally {
		lock.releaseLock();
	}
}

function inspectVerificationMessage(token, messageId) {
	const message = Gmail.Users.Messages.get('me', messageId, { format: 'raw' });
	const raw = Utilities.newBlob(Utilities.base64DecodeWebSafe(message.raw)).getDataAsString('UTF-8');
	const headers = parseHeaders(raw);
	const subject = headers.subject || '';
	if (subject !== `[KOSEN-AUTH] ${token.code}` || !withinTokenWindow(token, message.internalDate)) return false;

	const senderDomain = domainFromAddress(headers.from);
	const school = findVerifiedSchool(senderDomain);
	const authentication = evaluateAuthentication(headers['authentication-results'] || '', senderDomain);
	if (!school || !authentication.accepted) {
		const attempts = Number(token.attempts) + 1;
		updateToken(token.row, { attempts, status: attempts >= MAX_ATTEMPTS ? 'failed' : 'active' });
		return attempts >= MAX_ATTEMPTS;
	}

	const roleId = requiredProperty('DISCORD_VERIFIED_ROLE_ID');
	try {
		assignDiscordRole(token.discordUserId, roleId);
		const verifiedAt = new Date();
		appendVerification({
			discordUserId: token.discordUserId,
			schoolId: school.schoolId,
			verifiedAt,
			expiresAt: oneYearAfter(verifiedAt),
			emailHmac: emailHmac(headers.from),
			roleId,
			assurance: school.assurance,
		});
		updateToken(token.row, { usedAt: verifiedAt.toISOString(), status: 'verified' });
		return true;
	} catch (error) {
		console.error(`Role assignment failed for ${token.discordUserId}`, error);
		return false;
	}
}

function expireVerifiedRoles() {
	const sheet = getSheet(VERIFICATION_SHEET);
	const rows = sheet.getDataRange().getValues();
	const now = new Date();
	rows.slice(1).forEach((row, index) => {
		if (row[7] !== 'active' || new Date(row[3]) > now) return;
		try {
			const hasNewerVerification = rows.slice(1).some((candidate, candidateIndex) => candidateIndex !== index
				&& candidate[0] === row[0]
				&& candidate[5] === row[5]
				&& candidate[7] === 'active'
				&& new Date(candidate[3]) > now);
			if (!hasNewerVerification) removeDiscordRole(row[0], row[5]);
			sheet.getRange(index + 2, 8).setValue('expired');
		} catch (error) {
			console.error(`Could not expire role for ${row[0]}`, error);
		}
	});
}

function setupSpreadsheet() {
	ensureHeaders(TOKEN_SHEET, ['Code', 'DiscordUserId', 'CreatedAt', 'ExpiresAt', 'UsedAt', 'Attempts', 'Status']);
	ensureHeaders(VERIFICATION_SHEET, ['DiscordUserId', 'SchoolId', 'VerifiedAt', 'ExpiresAt', 'EmailHmac', 'RoleId', 'Assurance', 'Status']);
	ensureHeaders(SCHOOL_SHEET, ['SchoolId', 'SchoolName', 'AllowedDomain', 'Assurance', 'SourceUrl', 'LastCheckedAt', 'Status']);
}

function installTriggers() {
	ScriptApp.getProjectTriggers().filter(trigger => ['pollVerificationMailbox', 'expireVerifiedRoles'].includes(trigger.getHandlerFunction())).forEach(trigger => ScriptApp.deleteTrigger(trigger));
	ScriptApp.newTrigger('pollVerificationMailbox').timeBased().everyMinutes(1).create();
	ScriptApp.newTrigger('expireVerifiedRoles').timeBased().everyHours(1).create();
}

function createVerificationToken(discordUserId) {
	const sheet = getSheet(TOKEN_SHEET);
	const existingCodes = new Set(sheet.getDataRange().getValues().slice(1).map(row => row[0]));
	let code = randomToken(10);
	while (existingCodes.has(code)) code = randomToken(10);
	const token = { code, discordUserId, createdAt: new Date().toISOString() };
	sheet.appendRow([token.code, token.discordUserId, token.createdAt, new Date(Date.now() + TOKEN_TTL_MS).toISOString(), '', 0, 'active']);
	return token;
}

function getActiveTokens() {
	const values = getSheet(TOKEN_SHEET).getDataRange().getValues();
	return values.slice(1).map((row, index) => ({
		row: index + 2,
		code: row[0],
		discordUserId: row[1],
		createdAt: row[2],
		expiresAt: row[3],
		attempts: row[5],
		status: row[6],
	})).filter(token => token.status === 'active');
}

function updateToken(row, values) {
	const sheet = getSheet(TOKEN_SHEET);
	if (values.usedAt !== undefined) sheet.getRange(row, 5).setValue(values.usedAt);
	if (values.attempts !== undefined) sheet.getRange(row, 6).setValue(values.attempts);
	if (values.status !== undefined) sheet.getRange(row, 7).setValue(values.status);
}

function findVerifiedSchool(domain) {
	if (!domain) return null;
	const rows = getSheet(SCHOOL_SHEET).getDataRange().getValues().slice(1);
	const match = rows.find(row => String(row[2]).toLowerCase() === domain && String(row[6]).toLowerCase() === 'verified');
	return match ? { schoolId: match[0], assurance: String(match[3]).toLowerCase() } : null;
}

function evaluateAuthentication(authenticationResults, fromDomain) {
	const dmarcPass = /\bdmarc=pass\b/i.test(authenticationResults);
	const dkimPass = /\bdkim=pass\b/i.test(authenticationResults);
	const spfPass = /\bspf=pass\b/i.test(authenticationResults);
	const dkimDomain = authResultDomain(authenticationResults, /\bheader\.(?:i|d)=<?[^@;\s]*@?([^;\s>]+)/i);
	const envelopeDomain = authResultDomain(authenticationResults, /\bsmtp\.mailfrom=([^;\s>]+)/i);
	return {
		accepted: dmarcPass || dkimPass && dkimDomain === fromDomain || spfPass && envelopeDomain === fromDomain,
	};
}

function assignDiscordRole(userId, roleId) {
	discordRequest(discordRoleUrl(userId, roleId), requiredProperty('DISCORD_BOT_TOKEN'), 'Bot', 'put');
}

function removeDiscordRole(userId, roleId) {
	discordRequest(discordRoleUrl(userId, roleId), requiredProperty('DISCORD_BOT_TOKEN'), 'Bot', 'delete');
}

function discordRoleUrl(userId, roleId) {
	return `https://discord.com/api/v10/guilds/${requiredProperty('DISCORD_GUILD_ID')}/members/${userId}/roles/${roleId}`;
}

function discordRequest(url, token, scheme, method) {
	const response = UrlFetchApp.fetch(url, {
		method: method || 'get',
		headers: { Authorization: `${scheme} ${token}` },
		muteHttpExceptions: true,
	});
	const status = response.getResponseCode();
	if (status < 200 || status >= 300) throw new Error(`Discord API ${status}: ${response.getContentText()}`);
	return response.getContentText() ? JSON.parse(response.getContentText()) : {};
}

function exchangeDiscordCode(code) {
	const response = UrlFetchApp.fetch('https://discord.com/api/v10/oauth2/token', {
		method: 'post',
		contentType: 'application/x-www-form-urlencoded',
		payload: toQueryString({
			client_id: requiredProperty('DISCORD_CLIENT_ID'),
			client_secret: requiredProperty('DISCORD_CLIENT_SECRET'),
			grant_type: 'authorization_code',
			code,
			redirect_uri: requiredProperty('DISCORD_REDIRECT_URI'),
		}),
		muteHttpExceptions: true,
	});
	if (response.getResponseCode() !== 200) throw new Error(`Discord OAuth ${response.getResponseCode()}: ${response.getContentText()}`);
	return JSON.parse(response.getContentText()).access_token;
}

function parseHeaders(raw) {
	const headerText = raw.split(/\r?\n\r?\n/, 1)[0].replace(/\r?\n[ \t]+/g, ' ');
	return headerText.split(/\r?\n/).reduce((headers, line) => {
		const match = line.match(/^([^:]+):\s*(.*)$/);
		if (match) headers[match[1].toLowerCase()] = headers[match[1].toLowerCase()] ? `${headers[match[1].toLowerCase()]}; ${match[2]}` : match[2];
		return headers;
	}, {});
}

function domainFromAddress(address) {
	const matches = String(address || '').match(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi) || [];
	if (matches.length !== 1) return null;
	return matches[0].split('@')[1].toLowerCase();
}

function authResultDomain(results, expression) {
	const match = String(results).match(expression);
	return match ? match[1].replace(/^@/, '').toLowerCase() : null;
}

function withinTokenWindow(token, internalDate) {
	const receivedAt = new Date(Number(internalDate));
	return receivedAt >= new Date(token.createdAt) && receivedAt < new Date(token.expiresAt);
}

function appendVerification(record) {
	getSheet(VERIFICATION_SHEET).appendRow([record.discordUserId, record.schoolId, record.verifiedAt.toISOString(), record.expiresAt.toISOString(), record.emailHmac, record.roleId, record.assurance, 'active']);
}

function emailHmac(address) {
	return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(String(address).toLowerCase(), requiredProperty('EMAIL_HMAC_KEY')));
}

function consumeState(state) {
	if (!state) return false;
	const lock = LockService.getScriptLock();
	lock.waitLock(5000);
	try {
		const properties = getProperties();
		const key = statePropertyKey(state);
		const raw = properties.getProperty(key);
		properties.deleteProperty(key);
		return raw && JSON.parse(raw).expiresAt > Date.now();
	} finally {
		lock.releaseLock();
	}
}

function statePropertyKey(state) {
	return `oauth-state:${state}`;
}

function getSheet(name) {
	const sheet = SpreadsheetApp.openById(requiredProperty('SPREADSHEET_ID')).getSheetByName(name);
	if (!sheet) throw new Error(`Missing sheet: ${name}`);
	return sheet;
}

function ensureHeaders(name, headers) {
	const spreadsheet = SpreadsheetApp.openById(requiredProperty('SPREADSHEET_ID'));
	const sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
	if (sheet.getLastRow() === 0) sheet.appendRow(headers);
}

function requiredProperty(name) {
	const value = getProperties().getProperty(name);
	if (!value) throw new Error(`Missing Script Property: ${name}`);
	return value;
}

function getProperties() {
	return PropertiesService.getScriptProperties();
}

function randomToken(bytes) {
	return Utilities.base64EncodeWebSafe(Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '')).replace(/[^A-Za-z0-9]/g, '').slice(0, bytes);
}

function gmailDate(date) {
	return Utilities.formatDate(date, 'GMT', 'yyyy/MM/dd');
}

function oneYearAfter(date) {
	const expiresAt = new Date(date);
	expiresAt.setFullYear(expiresAt.getFullYear() + 1);
	return expiresAt;
}

function toQueryString(values) {
	return Object.keys(values).map(key => `${encodeURIComponent(key)}=${encodeURIComponent(values[key])}`).join('&');
}

function html(title, body) {
	return HtmlService.createHtmlOutput(`<!doctype html><html><head><base target="_top"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><h1>${escapeHtml(title)}</h1><p>${body}</p></body></html>`);
}

function escapeHtml(value) {
	return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
