document.addEventListener('DOMContentLoaded', async () => {
    // --- Elementos de Configuração ---
    const apiIdInput = document.getElementById('apiId');
    const apiHashInput = document.getElementById('apiHash');
    const saveConfigBtn = document.getElementById('saveConfigBtn');

    // --- Elementos de Autenticação ---
    const authStatusText = document.getElementById('auth-status-text');
    const authPhoneStep = document.getElementById('auth-phone-step');
    const phoneNumberInput = document.getElementById('phoneNumber');
    const sendPhoneBtn = document.getElementById('sendPhoneBtn');
    const authPasswordStep = document.getElementById('auth-password-step');
    const passwordInput = document.getElementById('password');
    const sendPasswordBtn = document.getElementById('sendPasswordBtn');
    const authCodeStep = document.getElementById('auth-code-step');
    const phoneCodeInput = document.getElementById('phoneCode');
    const sendCodeBtn = document.getElementById('sendCodeBtn');
    const authCompletedActions = document.getElementById('auth-completed-actions');
    const sessionStringTextarea = document.getElementById('sessionString');
    const logoutBtn = document.getElementById('logoutBtn');

    // --- Elementos de Gerenciamento de Grupos ---
    const groupManagementSection = document.getElementById('group-management-section');
    const listGroupsBtn = document.getElementById('listGroupsBtn');
    const groupCheckboxesDiv = document.getElementById('group-checkboxes');
    const selectAllGroupsBtn = document.getElementById('selectAllGroupsBtn');
    const deselectAllGroupsBtn = document.getElementById('deselectAllGroupsBtn');
    const leaveSelectedGroupsBtn = document.getElementById('leaveSelectedGroupsBtn');

    // --- Elemento de Status Global ---
    const statusMessageDiv = document.getElementById('status-message');

    let groupsData = [];
    let currentSessionId = localStorage.getItem('sessionId') || Math.random().toString(36).substring(2, 15);
    localStorage.setItem('sessionId', currentSessionId); // Persiste o sessionId no localStorage

    // --- Funções de UI ---

    function showStatus(message, type = 'info') {
        statusMessageDiv.textContent = message;
        statusMessageDiv.className = `message ${type}`;
        // Não esconde a mensagem automaticamente se for um erro crítico, ou se for uma mensagem importante
        // Para mensagens informativas, pode manter o timeout
        if (type !== 'error' && type !== 'warning') {
            setTimeout(() => {
                statusMessageDiv.textContent = '';
                statusMessageDiv.className = 'message';
            }, 5000);
        }
    }

    function showAuthStep(step) {
        authPhoneStep.style.display = 'none';
        authPasswordStep.style.display = 'none';
        authCodeStep.style.display = 'none';
        authCompletedActions.style.display = 'none';
        groupManagementSection.style.display = 'none'; // Sempre esconde a seção de grupos por padrão

        if (step === 'phone') {
            authPhoneStep.style.display = 'block';
            authStatusText.textContent = 'Por favor, insira seu número de telefone para começar o login.';
            phoneNumberInput.focus();
        } else if (step === 'password') {
            authPasswordStep.style.display = 'block';
            authStatusText.textContent = 'Senha 2FA necessária. Por favor, insira sua senha.';
            passwordInput.focus();
        } else if (step === 'phoneCode') {
            authCodeStep.style.display = 'block';
            authStatusText.textContent = 'Código de verificação enviado. Por favor, insira-o.';
            phoneCodeInput.focus();
        } else if (step === 'completed') {
            authCompletedActions.style.display = 'block';
            groupManagementSection.style.display = 'block'; // Mostra a seção de grupos
            authStatusText.textContent = 'Você está logado!';
        } else {
            authStatusText.textContent = 'Status desconhecido.';
        }
    }

    function renderGroups(groups) {
        groupCheckboxesDiv.innerHTML = '';
        if (groups.length === 0) {
            groupCheckboxesDiv.innerHTML = '<p>Nenhum grupo encontrado.</p>';
            return;
        }

        groups.forEach(group => {
            const div = document.createElement('div');
            div.className = 'group-item';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `group-${group.id}`;
            checkbox.value = group.id;
            checkbox.className = 'group-checkbox';

            const label = document.createElement('label');
            label.htmlFor = `group-${group.id}`;
            label.textContent = `${group.title} (ID: ${group.id}) ${group.isArchived ? '[ARQUIVADO]' : ''}`;

            div.appendChild(checkbox);
            div.appendChild(label);
            groupCheckboxesDiv.appendChild(div);
        });
    }

    // --- Funções de Lógica ---

    // Função para buscar e renderizar grupos
    async function fetchAndRenderGroups() {
        groupCheckboxesDiv.innerHTML = '<p>Carregando grupos...</p>';
        showStatus('Buscando seus grupos Telegram...', 'info');
        try {
            const response = await fetch('/api/groups');
            const result = await response.json();

            if (result.success) {
                groupsData = result.groups;
                renderGroups(groupsData);
                showStatus(`Foram listados ${groupsData.length} grupos.`, 'success');
                return true; // Sucesso na listagem
            } else {
                groupCheckboxesDiv.innerHTML = '<p>Erro ao listar grupos. A sessão pode ter expirado ou estar inválida.</p>';
                showStatus(result.message, 'error');
                return false; // Falha na listagem
            }
        } catch (error) {
            groupCheckboxesDiv.innerHTML = '<p>Erro ao listar grupos.</p>';
            showStatus('Erro ao listar grupos: ' + error.message + '. Tente deslogar e logar novamente.', 'error');
            return false; // Falha na listagem
        }
    }

    // Carregar configurações iniciais e verificar status da sessão (CORRIGIDO)
    async function loadConfigAndSessionStatus() {
        try {
            const response = await fetch('/api/config');
            const config = await response.json();

            if (config.apiId) apiIdInput.value = config.apiId;
            if (config.apiHash) apiHashInput.value = config.apiHash;

            if (config.sessionString && config.apiId && config.apiHash) {
                sessionStringTextarea.value = config.sessionString;
                showStatus('Sessão encontrada. Verificando login automático...', 'info');
                const groupsLoaded = await fetchAndRenderGroups(); // Tenta carregar grupos
                if (groupsLoaded) {
                    showAuthStep('completed'); // Se carregou, está logado
                    showStatus('Login automático bem-sucedido e grupos carregados!', 'success');
                } else {
                    // Se a sessão existe mas não conseguiu listar grupos, pode estar inválida
                    sessionStringTextarea.value = ''; // Limpa a sessão exibida
                    showAuthStep('phone'); // Volta para o login
                    showStatus('Sessão inválida ou expirada. Por favor, autentique-se novamente.', 'warning');
                }
            } else {
                sessionStringTextarea.value = '';
                showAuthStep('phone'); // Vai para o passo do telefone se não houver sessão ou credenciais
                showStatus('Por favor, configure API ID/Hash e faça o login.', 'info');
            }
        } catch (error) {
            showStatus('Erro ao carregar configurações iniciais: ' + error.message, 'error');
            showAuthStep('phone');
        }
    }

    // Salvar API ID e API Hash
    saveConfigBtn.addEventListener('click', async () => {
        const apiId = apiIdInput.value;
        const apiHash = apiHashInput.value;

        if (!apiId || !apiHash) {
            showStatus('Por favor, preencha o API ID e o API Hash.', 'warning');
            return;
        }

        try {
            const response = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiId, apiHash })
            });
            const result = await response.json();
            if (result.success) {
                showStatus(result.message, 'success');
                // Após salvar, tenta recarregar as configurações para verificar a sessão
                await loadConfigAndSessionStatus();
            } else {
                showStatus(result.message, 'error');
            }
        } catch (error) {
            showStatus('Erro ao salvar configurações: ' + error.message, 'error');
        }
    });

    // Enviar Número de Telefone
    sendPhoneBtn.addEventListener('click', async () => {
        const phoneNumber = phoneNumberInput.value.trim();
        if (!phoneNumber) {
            showStatus('Por favor, insira seu número de telefone.', 'warning');
            return;
        }
        showStatus('Enviando número... Verifique seu Telegram para um código.', 'info');

        try {
            const response = await fetch('/api/auth/send-phone', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phoneNumber, sessionId: currentSessionId })
            });
            const result = await response.json();

            if (result.success) {
                if (result.step === 'completed') {
                    // Raramente acontece aqui, mas para garantir
                    sessionStringTextarea.value = result.sessionString;
                    showAuthStep('completed');
                    showStatus(result.message, 'success');
                    await fetchAndRenderGroups();
                } else {
                    showAuthStep(result.step); // password ou phoneCode
                    showStatus(result.message, 'info');
                }
            } else {
                showStatus(result.message, 'error');
            }
        } catch (error) {
            showStatus('Erro ao enviar número: ' + error.message + '. Verifique o número e tente novamente.', 'error');
        }
    });

    // Enviar Senha 2FA
    sendPasswordBtn.addEventListener('click', async () => {
        const password = passwordInput.value.trim();
        if (!password) {
            showStatus('Por favor, insira sua senha 2FA.', 'warning');
            return;
        }
        showStatus('Enviando senha...', 'info');

        try {
            const response = await fetch('/api/auth/send-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password, sessionId: currentSessionId })
            });
            const result = await response.json();

            if (result.success) {
                if (result.step === 'completed') {
                    sessionStringTextarea.value = result.sessionString;
                    showAuthStep('completed');
                    showStatus(result.message, 'success');
                    await fetchAndRenderGroups();
                } else {
                    showStatus(result.message + ' Algo deu errado após a senha. Tente novamente.', 'error');
                    showAuthStep('phone'); // Volta para o início
                }
            } else {
                showStatus(result.message, 'error');
            }
        } catch (error) {
            showStatus('Erro ao enviar senha: ' + error.message + '. Tente novamente.', 'error');
        }
    });

    // Enviar Código de Verificação
    sendCodeBtn.addEventListener('click', async () => {
        const phoneCode = phoneCodeInput.value.trim();
        if (!phoneCode) {
            showStatus('Por favor, insira o código de verificação.', 'warning');
            return;
        }
        showStatus('Enviando código...', 'info');

        try {
            const response = await fetch('/api/auth/send-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phoneCode, sessionId: currentSessionId })
            });
            const result = await response.json();

            if (result.success) {
                if (result.step === 'completed') {
                    sessionStringTextarea.value = result.sessionString;
                    showAuthStep('completed');
                    showStatus(result.message, 'success');
                    await fetchAndRenderGroups();
                } else if (result.step === 'password') {
                    showAuthStep(result.step); // Senha 2FA
                    showStatus(result.message, 'info');
                } else {
                    showStatus(result.message + ' Algo deu errado após o código. Tente novamente.', 'error');
                    showAuthStep('phone'); // Volta para o início
                }
            } else {
                showStatus(result.message, 'error');
            }
        } catch (error) {
            showStatus('Erro ao enviar código: ' + error.message + '. Tente novamente.', 'error');
        }
    });

    // Deslogar
    logoutBtn.addEventListener('click', async () => {
        if (!confirm('Tem certeza que deseja deslogar? Isso removerá a sessão salva e exigirá novo login.')) {
            showStatus('Operação cancelada.', 'info');
            return;
        }
        showStatus('Deslogando...', 'info');
        try {
            const response = await fetch('/api/logout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: currentSessionId })
            });
            const result = await response.json();
            if (result.success) {
                showStatus(result.message, 'success');
                sessionStringTextarea.value = '';
                groupCheckboxesDiv.innerHTML = '<p>Faça login para listar os grupos.</p>';
                localStorage.removeItem('sessionId'); // Remove o ID de sessão do localStorage
                currentSessionId = Math.random().toString(36).substring(2, 15); // Gera um novo ID de sessão
                localStorage.setItem('sessionId', currentSessionId);
                showAuthStep('phone');
            } else {
                showStatus(result.message, 'error');
            }
        } catch (error) {
            showStatus('Erro ao deslogar: ' + error.message, 'error');
        }
    });

    // Listar Grupos (botão de "Atualizar Lista")
    listGroupsBtn.addEventListener('click', fetchAndRenderGroups);

    // Selecionar todos os grupos
    selectAllGroupsBtn.addEventListener('click', () => {
        const checkboxes = document.querySelectorAll('.group-checkbox');
        checkboxes.forEach(cb => cb.checked = true);
        showStatus('Todos os grupos foram selecionados.', 'info');
    });

    // Desmarcar todos os grupos
    deselectAllGroupsBtn.addEventListener('click', () => {
        const checkboxes = document.querySelectorAll('.group-checkbox');
        checkboxes.forEach(cb => cb.checked = false);
        showStatus('Todos os grupos foram desmarcados.', 'info');
    });

    // Sair dos grupos selecionados
    leaveSelectedGroupsBtn.addEventListener('click', async () => {
        const selectedGroupIds = Array.from(document.querySelectorAll('.group-checkbox:checked'))
                                     .map(cb => cb.value);

        if (selectedGroupIds.length === 0) {
            showStatus('Nenhum grupo selecionado para sair.', 'warning');
            return;
        }

        if (!confirm(`Tem certeza que deseja sair de ${selectedGroupIds.length} grupo(s)? Esta ação é irreversível!`)) {
            showStatus('Operação cancelada.', 'info');
            return;
        }

        showStatus(`Saindo de ${selectedGroupIds.length} grupo(s)...`, 'info');

        try {
            const response = await fetch('/api/leave-groups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ groupIds: selectedGroupIds })
            });
            const result = await response.json();

            if (result.success) {
                const successfulLeaves = result.results.filter(r => r.status === 'Sucesso').length;
                const failedLeaves = result.results.filter(r => r.status === 'Falha');

                let msg = `${successfulLeaves} grupo(s) foram saídos com sucesso.`;
                if (failedLeaves.length > 0) {
                    msg += ` ${failedLeaves.length} falharam.`;
                    showStatus(msg, 'warning');
                } else {
                    showStatus(msg, 'success');
                }

                await fetchAndRenderGroups();
            } else {
                showStatus(result.message, 'error');
            }
        } catch (error) {
            showStatus('Erro ao tentar sair de grupos: ' + error.message, 'error');
        }
    });

    // Iniciar o carregamento das configurações ao carregar a página
    loadConfigAndSessionStatus();
});