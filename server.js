const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs').promises;
const path = require('path');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Logger } = require('telegram/extensions/Logger');

// Desativar logging detalhado do Telegram.js, apenas erros e warnings
Logger.setLevel('warn');

const app = express();
const PORT = process.env.PORT || 3000;
const CONFIG_FILE = 'config.json';

// --- Middleware ---
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Mapa para armazenar instâncias de clientes Telegram e seus estados de autenticação por sessionId ---
const clientSessions = new Map(); // key: sessionId, value: { client: TelegramClient, authState: { phoneCodeHash, sentCode, phoneNumber, passwordNeeded } }

// --- Funções de Leitura/Escrita do JSON ---
async function readConfig() {
    try {
        const data = await fs.readFile(CONFIG_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('ℹ️ Arquivo de configuração não encontrado. Criando um novo.');
            return { apiId: null, apiHash: null, sessionString: '' };
        }
        console.error('❌ Erro ao ler o arquivo de configuração:', error);
        return { apiId: null, apiHash: null, sessionString: '' };
    }
}

async function saveConfig(config) {
    try {
        await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
        console.log('💾 Configurações salvas em config.json');
    } catch (error) {
        console.error('❌ Erro ao salvar o arquivo de configuração:', error);
    }
}

// --- Rotas da API ---

// Rota para carregar as configurações (API ID, API Hash, Session String)
app.get('/api/config', async (req, res) => {
    const config = await readConfig();
    res.json({
        apiId: config.apiId,
        apiHash: config.apiHash,
        sessionString: config.sessionString
    });
});

// Rota para salvar as configurações (API ID, API Hash)
app.post('/api/config', async (req, res) => {
    const { apiId, apiHash } = req.body;
    if (!apiId || !apiHash) {
        return res.status(400).json({ success: false, message: 'API ID e API Hash são obrigatórios.' });
    }

    let config = await readConfig();
    config.apiId = parseInt(apiId, 10);
    config.apiHash = apiHash;

    await saveConfig(config);
    res.json({ success: true, message: 'Configurações salvas com sucesso!' });
});

// Rota para iniciar o login (passo 1: enviar número de telefone)
app.post('/api/auth/send-phone', async (req, res) => {
    const { phoneNumber, sessionId } = req.body;
    const config = await readConfig();
    const { apiId, apiHash } = config;

    if (!apiId || !apiHash) {
        return res.status(400).json({ success: false, message: 'API ID e API Hash não configurados.' });
    }
    if (!phoneNumber) {
        return res.status(400).json({ success: false, message: 'Número de telefone é obrigatório.' });
    }

    if (config.sessionString) {
        try {
            // Se o cliente conectou e não houve erro, a sessão é válida
            console.log(`✅ Login direto bem-sucedido com sessão existente (sessão ${sessionId}).`);
            res.json({ success: true, message: 'Login bem-sucedido com sessão existente!', step: 'completed', sessionString: config.sessionString });
            return; // Encerra aqui se a sessão é válida
        } catch (e) {
            // Se a sessão existente falhou, continua com o fluxo normal
            console.warn(`Sessão existente inválida para ${sessionId}. Iniciando novo login.`);
        }
    }

    // Se já existe uma sessão para este client, desconecta e remove
    if (clientSessions.has(sessionId)) {
        const existingClient = clientSessions.get(sessionId).client;
        if (existingClient.connected) {
            await existingClient.disconnect();
        }
        clientSessions.delete(sessionId);
        console.log(`Sessão antiga ${sessionId} limpa.`);
    }

    const client = new TelegramClient(
        new StringSession(config.sessionString || ''),
        apiId,
        apiHash,
        { connectionRetries: 5 }
    );
    clientSessions.set(sessionId, { client, authState: { phoneNumber: phoneNumber } });

    try {
        await client.connect();

        // Tenta fazer o login com a sessão existente primeiro
        if (config.sessionString) {
            try {
                // Se o cliente conectou e não houve erro, a sessão é válida
                console.log(`✅ Login direto bem-sucedido com sessão existente (sessão ${sessionId}).`);
                res.json({ success: true, message: 'Login bem-sucedido com sessão existente!', step: 'completed', sessionString: config.sessionString });
                return; // Encerra aqui se a sessão é válida
            } catch (e) {
                // Se a sessão existente falhou, continua com o fluxo normal
                console.warn(`Sessão existente inválida para ${sessionId}. Iniciando novo login.`);
            }
        }

        // Se não usou sessão existente ou falhou, inicia o fluxo de envio de código
        const result = await client.invoke(
            new Api.auth.SendCode({
                phoneNumber: phoneNumber,
                apiId: apiId,
                apiHash: apiHash,
                settings: new Api.CodeSettings({
                    allowFlashCall: false, // Desabilitar chamada flash
                    currentNumber: false,
                    allowAppHash: false // Desabilitar hash de app
                }),
            })
        );

        clientSessions.get(sessionId).authState.phoneCodeHash = result.phoneCodeHash;
        clientSessions.get(sessionId).authState.sentCode = result; // Guarda o objeto completo para next_type

        console.log(`Código de verificação enviado para ${phoneNumber} (sessão ${sessionId}).`);
        res.json({ success: true, message: 'Código de verificação enviado. Por favor, insira-o.', step: 'phoneCode' });

    } catch (error) {
        console.error(`❌ Erro ao enviar número para ${phoneNumber} (sessão ${sessionId}):`, error.message);
        // Desconecta o cliente em caso de erro para liberar recursos
        if (client.connected) {
            await client.disconnect();
        }
        clientSessions.delete(sessionId);
        res.status(500).json({ success: false, message: `Erro ao enviar número: ${error.message}` });
    }
});

// Nova rota para enviar código de verificação
app.post('/api/auth/send-code', async (req, res) => {
    const { phoneCode, sessionId } = req.body;
    const clientState = clientSessions.get(sessionId);

    if (!clientState || !clientState.client || !clientState.authState.phoneCodeHash) {
        return res.status(400).json({ success: false, message: 'Sessão de autenticação inválida ou ausente. Por favor, comece novamente.' });
    }
    if (!phoneCode) {
        return res.status(400).json({ success: false, message: 'Código de verificação é obrigatório.' });
    }

    const { client, authState } = clientState;
    const { phoneNumber, phoneCodeHash } = authState;

    try {
        const result = await client.invoke(
            new Api.auth.SignIn({
                phoneNumber: phoneNumber,
                phoneCodeHash: phoneCodeHash,
                phoneCode: phoneCode,
            })
        );

        const config = await readConfig();
        const newSessionString = client.session.save();
        config.sessionString = newSessionString;
        await saveConfig(config);

        console.log(`✅ Login completo com código (sessão ${sessionId}).`);
        res.json({ success: true, message: 'Login bem-sucedido!', step: 'completed', sessionString: newSessionString });

    } catch (error) {
        console.error(`❌ Erro ao enviar código (sessão ${sessionId}):`, error.message);
        if (error.className === 'SessionPasswordNeededError') {
            clientState.authState.passwordNeeded = true; // Sinaliza que a senha é necessária
            res.json({ success: true, message: 'Senha 2FA necessária. Por favor, forneça a senha.', step: 'password' });
        } else {
            // Desconecta o cliente em caso de erro no código
            if (client.connected) {
                await client.disconnect();
            }
            clientSessions.delete(sessionId);
            res.status(500).json({ success: false, message: `Erro no código de verificação: ${error.message}` });
        }
    }
});

// Nova rota para enviar senha 2FA
app.post('/api/auth/send-password', async (req, res) => {
    const { password, sessionId } = req.body;
    const clientState = clientSessions.get(sessionId);

    if (!clientState || !clientState.client || !clientState.authState.phoneCodeHash) {
        return res.status(400).json({ success: false, message: 'Sessão de autenticação inválida ou ausente. Por favor, comece novamente.' });
    }
    if (!password) {
        return res.status(400).json({ success: false, message: 'Senha é obrigatória.' });
    }

    const { client, authState } = clientState;
    const { phoneNumber, phoneCodeHash } = authState; // Ainda precisamos deles para o sign-in final

    try {
        const result = await client.invoke(
            new Api.auth.CheckPassword({
                password: password,
            })
        );

        const config = await readConfig();
        const newSessionString = client.session.save();
        config.sessionString = newSessionString;
        await saveConfig(config);

        console.log(`✅ Senha 2FA aceita, login completo (sessão ${sessionId}).`);
        res.json({ success: true, message: 'Login bem-sucedido!', step: 'completed', sessionString: newSessionString });

    } catch (error) {
        console.error(`❌ Erro ao enviar senha (sessão ${sessionId}):`, error.message);
        // Desconecta o cliente em caso de erro na senha
        if (client.connected) {
            await client.disconnect();
        }
        clientSessions.delete(sessionId);
        res.status(500).json({ success: false, message: `Erro na senha 2FA: ${error.message}` });
    }
});

// Rota para listar grupos
app.get('/api/groups', async (req, res) => {
    const config = await readConfig();
    const apiId = config.apiId;
    const apiHash = config.apiHash;
    const sessionString = config.sessionString;

    if (!apiId || !apiHash || !sessionString) {
        return res.status(400).json({ success: false, message: 'Credenciais ou sessão não configuradas. Por favor, configure-as e autentique-se.' });
    }

    // Criar um novo cliente para esta operação específica, usando a sessão persistida
    const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
        connectionRetries: 5,
    });

    try {
        await client.connect();
        if (!client.connected) {
            // Tenta se conectar, se falhar, sugere re-autenticação
            return res.status(500).json({ success: false, message: 'Falha ao conectar ao Telegram. A sessão pode estar inválida. Tente autenticar novamente.' });
        }

        const dialogs = await client.getDialogs({});
        const groups = dialogs
            .filter(dialog => dialog.isGroup)
            .map(dialog => ({
                id: dialog.id.toString(),
                title: dialog.title,
                isArchived: dialog.isArchived,
                isChannel: dialog.isChannel,
                unreadCount: dialog.unreadCount
            }));
        res.json({ success: true, groups });
    } catch (error) {
        console.error('❌ Erro ao listar grupos:', error);
        res.status(500).json({ success: false, message: `Erro ao listar grupos: ${error.message}. A sessão pode ter expirado. Tente autenticar novamente.` });
    } finally {
        if (client.connected) {
            await client.disconnect();
        }
    }
});

app.post('/api/leave-groups', async (req, res) => {
    // groupIds agora será um array de objetos: [{id: '...', peerType: 'channel'}, {id: '...', peerType: 'chat'}]
    const { groupIds } = req.body; // Renomeado para clareza

    console.log('Sair de grupos:', groupIds);
    
    if (!Array.isArray(groupIds) || groupIds.length === 0) {
        return res.status(400).json({ success: false, message: 'IDs de grupos inválidos ou vazios.' });
    }

    const config = await readConfig();
    const apiId = config.apiId;
    const apiHash = config.apiHash;
    const sessionString = config.sessionString;

    if (!apiId || !apiHash || !sessionString) {
        return res.status(400).json({ success: false, message: 'Credenciais ou sessão não configuradas.' });
    }

    const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
        connectionRetries: 5,
    });

    const results = [];

    try {
        await client.connect();
        if (!client.connected) {
            return res.status(500).json({ success: false, message: 'Falha ao conectar ao Telegram para sair de grupos. A sessão pode estar inválida.' });
        }

        for (const groupInfo of groupIds) { // Itera sobre o array de objetos
            const { id: groupId, peerType } = groupInfo; // Desestrutura o id e o peerType
            console.log('Grupo ID:', groupId, 'Tipo:', peerType);
           
            try {
                let success = false;
                let message = '';

                if (peerType === 'channel') {
                    // Para canais e supergrupos
                    let channelId = parseInt(groupId.startsWith('-100') ? groupId.substring(4) : groupId, 10);
                    let peer = new Api.PeerChannel({ channelId: channelId });

                    await client.invoke(
                        new Api.channels.LeaveChannel({
                            channel: peer
                        })
                    );
                    success = true;
                    message = 'Saiu do canal/supergrupo.';
                } else if (peerType === 'chat') {
                    // Para grupos básicos
                    let chatId = parseInt(groupId, 10);
                    // O id do chat deve ser positivo para PeerChat, mas dialog.id pode ser negativo.
                    // O telegram.js geralmente lida com isso se você passar dialog.entity.
                    // Se você está usando o ID diretamente, o PeerChat aceita o ID negativo sem o -100 prefixo.
                    // Ou se for um ID de chat que vem de dialog.id, ele já está formatado.
                    // A maneira mais segura é pegar o dialog.entity original.
                    // Como não estamos persistindo o dialog.entity, vamos tentar com PeerChat.
                    let peer = new Api.PeerChat({ chatId: chatId }); // Use o ID diretamente aqui

                    // Para sair de um grupo básico, você remove a si mesmo do chat.
                    await client.invoke(
                        new Api.messages.DeleteChatUser({
                            chatId: chatId,
                            userId: new Api.InputUserSelf(), // Remove a si mesmo
                        })
                    );
                    success = true;
                    message = 'Saiu do grupo básico.';
                } else {
                    message = `Tipo de grupo desconhecido para ID ${groupId}.`;
                }

                if (success) {
                    results.push({ id: groupId, status: 'Sucesso', message: message });
                } else {
                    results.push({ id: groupId, status: 'Falha', message: message });
                }

            } catch (error) {
                let errorMessage = `Erro ao sair do grupo ${groupId}: ${error.message}`;
                if (error.className === 'PeerIdInvalidError') {
                    errorMessage = `ID de grupo inválido para ${groupId} ou você não é membro.`;
                } else if (error.className === 'ChannelPrivateError' || error.className === 'ChatAdminRequiredError') {
                    errorMessage = `Não foi possível sair do grupo ${groupId}: acesso negado (pode ser um chat privado, você não é membro, ou permissão necessária).`;
                } else if (error.className === 'UserBotBlockedError') {
                    errorMessage = `O bot foi bloqueado no grupo ${groupId}.`;
                } else if (error.className === 'ChatIdInvalidError' && peerType === 'chat') {
                    // Isso pode acontecer se o ID do chat básico estiver incorreto ou o chat não existir mais.
                    errorMessage = `ID de grupo básico inválido para ${groupId}.`;
                } else if (error.className === 'CHANNEL_INVALID') {
                     errorMessage = `CHANNEL_INVALID para ${groupId}. Provavelmente o ID ou tipo de peer está incorreto.`;
                }
                console.error(errorMessage);
                results.push({ id: groupId, status: 'Falha', message: errorMessage });
            }
        }
        res.json({ success: true, results });

    } catch (error) {
        console.error('❌ Erro na operação de saída de grupos:', error);
        res.status(500).json({ success: false, message: `Erro geral ao sair de grupos: ${error.message}` });
    } finally {
        if (client.connected) {
            await client.disconnect();
        }
    }
});

// ... (Resto do código) ...
// Rota para deslogar
app.post('/api/logout', async (req, res) => {
    let config = await readConfig();
    config.sessionString = ''; // Limpa a sessão
    await saveConfig(config);
    // Limpa também o cliente Telegram associado a esta sessão, se existir
    const { sessionId } = req.body;
    if (sessionId && clientSessions.has(sessionId)) {
        const clientState = clientSessions.get(sessionId);
        if (clientState.client.connected) {
            await clientState.client.disconnect();
        }
        clientSessions.delete(sessionId);
        console.log(`Sessão de cliente ${sessionId} removida.`);
    }
    res.json({ success: true, message: 'Sessão limpa com sucesso. Por favor, recarregue a página.' });
});


// --- Iniciar Servidor ---
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
    console.log('Acesse seu navegador para configurar as credenciais do Telegram e interagir.');
});