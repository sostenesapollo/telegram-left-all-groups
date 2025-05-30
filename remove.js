const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');

const stringSession = new StringSession('COPIA SUA SESSION COMPLETA AQUI');

// Lá no list vc vai pegar os grupos e jogar aqui e pronto
const groupIds = [
    "-561091174"
];

const main = async () => {
    const client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
    });

    await client.start({
        phoneNumber: async () => await input.text('Seu número: '),
        password: async () => await input.text('Sua senha 2FA: '),
        phoneCode: async () => await input.text('Código recebido: '),
        onError: (err) => console.log(err),
    });

    console.log('✅ Logado!');
    console.log('🎯 Session String:', client.session.save());

    await client.disconnect();
};

main();
