export class CollectionError extends Error {
  constructor(message, code = 'LIBRARY_UNAVAILABLE') {
    super(message);
    this.name = 'CollectionError';
    this.code = code;
  }
}

// Não inclui mensagens brutas, URLs ou parâmetros em respostas ou logs.
export function collectionFailure(error, { stage, httpStatus = 0 } = {}) {
  if (error instanceof CollectionError) return error;
  const detail = String(error?.message || '');
  const networkCode = detail.match(/net::(ERR_[A-Z0-9_]+)/)?.[1];
  let code, message;
  if (stage === 'browser_setup') {
    code = 'BROWSER_SETUP_FAILED';
    message = 'O navegador da coleta não pôde ser preparado no servidor. Confira o empacotamento do Chromium no deploy.';
  } else if (stage === 'browser_launch' || stage === 'browser_context') {
    code = 'BROWSER_START_FAILED';
    message = 'O navegador da coleta não conseguiu iniciar no servidor. Confira os logs da função na Vercel.';
  } else if (/^ERR_(CERT_|SSL_)/.test(networkCode || '')) {
    code = 'FACEBOOK_TLS_FAILED';
    message = 'A conexão HTTPS com o Facebook falhou na verificação do certificado.';
  } else if (networkCode === 'ERR_NAME_NOT_RESOLVED') {
    code = 'FACEBOOK_DNS_FAILED';
    message = 'O servidor não conseguiu localizar o endereço do Facebook (DNS).';
  } else if (['ERR_PROXY_CONNECTION_FAILED', 'ERR_TUNNEL_CONNECTION_FAILED', 'ERR_NO_SUPPORTED_PROXIES'].includes(networkCode)) {
    code = 'FACEBOOK_PROXY_FAILED';
    message = 'O proxy de rede do servidor não conseguiu conectar ao Facebook.';
  } else if (httpStatus >= 400) {
    code = 'FACEBOOK_HTTP_FAILED';
    message = `O Facebook retornou HTTP ${httpStatus} durante a consulta.`;
  } else if (error?.name === 'TimeoutError' || /TIMED_OUT/.test(networkCode || '')) {
    code = 'FACEBOOK_TIMEOUT';
    message = 'O Facebook não concluiu a consulta dentro do tempo disponível.';
  } else if (/Target.*closed|browser has been closed|browser.*disconnected/i.test(detail)) {
    code = 'BROWSER_CLOSED';
    message = 'O navegador da coleta foi encerrado antes de concluir a consulta.';
  } else {
    code = 'FACEBOOK_CONNECTION_FAILED';
    message = 'A conexão do servidor com o Facebook falhou durante a consulta.';
  }
  return new CollectionError(`${message} A última contagem foi preservada. Código: ${code}${networkCode ? ` (${networkCode})` : ''}.`, code);
}

export function reportCollectionFailure(error, { stage, httpStatus }) {
  console.error('[tracker:collection]', { code: error.code, stage, httpStatus });
}
